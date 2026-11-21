export { errorCode, errorMessage } from "./api/errors";
export { webRoutes, type BusinessOptions, type BusinessRoute } from "./api/routes";
export { clearWebPortalStorage, normalizeWebUrl } from "./api/web-transport";
export {
  business,
  invokeDesktop,
  isDesktopApp,
  native,
  registerDesktopTransport,
  type Connection,
} from "./api/client";
