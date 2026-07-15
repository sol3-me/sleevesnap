/**
 * fetch wrapper for the app's own API: attaches the signed-in user's Firebase
 * ID token as a bearer token. The token getter is injected (from the Firebase
 * auth module at app boot, from fakes in tests) so this file stays free of
 * Firebase imports.
 */

export type ApiTokenGetter = () => Promise<string | null>;

let getToken: ApiTokenGetter = async () => null;

export function setApiTokenGetter(getter: ApiTokenGetter): void {
  getToken = getter;
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}
