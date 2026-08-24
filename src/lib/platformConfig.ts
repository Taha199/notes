/** Whether new account registration is allowed (defaults to true if unreachable). */
export async function fetchRegistrationEnabled(): Promise<boolean> {
  try {
    const res = await fetch('/api/platform-config');
    if (!res.ok) return true;
    const data = (await res.json()) as { registrationEnabled?: boolean };
    return data.registrationEnabled !== false;
  } catch {
    return true;
  }
}
