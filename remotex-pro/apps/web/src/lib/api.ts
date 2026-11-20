export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
export function token() {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem("remotex_token") ?? "";
}
export async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type","application/json");
  const t = token();
  if (t) headers.set("Authorization",`Bearer ${t}`);
  const response = await fetch(`${API}${path}`,{...init,headers,cache:"no-store"});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}
