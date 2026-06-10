import { listActiveCountryCodes } from "./user-phone-utils.js";

export async function handleCountryCodes() {
  const data = await listActiveCountryCodes();
  return {
    data,
    meta: { count: data.length },
  };
}
