export type RouteFunction = (req: Request) => Promise<Response | null>;
export type RenderFunction = (res: Response, root: HTMLElement) => Promise<void>;
export type RootFunction = (doc: Document) => HTMLElement;
export type MountFunction = (root: HTMLElement, params: {window: Window, h0: H0Navigator}) => void;
export type Handler = (req: Request, historyMode: HistoryMode) => boolean;
interface H0Options {
    firstPass: "server" | "client" | "manual"
    updates: "server" | "client" | "worker" | "none"
}

type HistoryMode = "push" | "replace" | "transparent";

interface H0Navigator {
    navigate(href: string, historyMode: HistoryMode): void;
    reload(): void;
}

export interface H0Spec {
    route: RouteFunction;
    render: RenderFunction;
    mount?: MountFunction;
    selectRoot: (root: Document) => HTMLElement;
    scope: string;
    options: H0Options;
}

let waitForServer: Promise<any> = Promise.resolve();

function initServiceWorker({scope}: H0Spec, index: string) {
    const swURL = new URL(scope, location.href);
    swURL.searchParams.set("h0-spec", index);
    waitForServer = (async () => {
        const reg = await navigator.serviceWorker.register(swURL.href, {scope, type: "module"})
        await reg.active;
    })();
}

function captureEvents(rootElement: HTMLElement, handle: Handler) {
    rootElement.addEventListener("submit", (event: SubmitEvent) => {
        const form = event.target as HTMLFormElement;
        let body : FormData | null = new FormData(form);
        const isGet = form.method.toUpperCase() === "GET";
        let action = form.action;
        if (isGet) {
            const url = new URL(action);
            for (const [k, v] of body)
                url.searchParams.append(k, v.toString());
            action = url.href;
            body = null;
        }

        const request = new Request(action, {body, method: form.method.toUpperCase()});
        if (!handle(request, "push"))
            event.preventDefault();
    }, {capture: true});

    rootElement.addEventListener("click", async (event: MouseEvent) => {
        if (!(event.target instanceof HTMLAnchorElement))
            return;
        const {href} = event.target as HTMLAnchorElement;
        if (!handle(new Request(href), "push"))
            event.preventDefault();
    }, {capture: true});
}

function createHandler({render, scope, route, selectRoot, options}: H0Spec) {
    return (req: Request, historyMode: HistoryMode) => {
        const {pathname} = new URL(req.url);
        if (!pathname.startsWith(scope))
            return false;

        const rootElement = selectRoot(document);

        (async() => {
            await waitForServer;
            const response = await ((options.updates === "client" ? route : fetch)(req));
            if (!response)
                location.href = req.url;
            else
                render(response, rootElement);
        })();

        return true;
    }
}

async function clientPass({scope}: H0Spec, handle: Handler, {location}: Window) {
    handle(new Request(location.pathname.startsWith(scope) ? location.href : scope), "replace");
}

export function initClient(spec: H0Spec, window: Window) {
    const rootElement = spec.selectRoot(window.document);
    if (!rootElement)
        throw new Error(`Root element not found`);

    const handler = createHandler(spec!);
    captureEvents(rootElement, handler);
    const h0 = {
        navigate: (href: string, historyMode: HistoryMode) => handler(new Request(href), historyMode),
        reload: () => handler(new Request(spec.scope), "transparent")
    };
    if (spec.mount)
        spec.mount(rootElement, {window, h0});
    clientPass(spec, handler, window);
    return h0;
}
