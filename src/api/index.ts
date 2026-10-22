export { createApiHandler, ROUTES, type ApiDeps, type Authorize, type AuthDecision, type RouteInfo } from './handler';
export { toAzureHandler, registerAzure, type AzureAppLike, type AzureRequestLike, type AzureResponseLike } from './azure';
export { ApiError, type ErrorCode } from './errors';
export * from './auth';
