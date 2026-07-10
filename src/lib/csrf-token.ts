let workbenchCsrfToken: string | null = null;
let workbenchCsrfRequired = process.env.NEXT_PUBLIC_SHANHAI_AUTH_MODE === "password";

export function setWorkbenchCsrfToken(token: string | null) {
  workbenchCsrfToken = token;
}

export function getWorkbenchCsrfToken() {
  return workbenchCsrfToken;
}

export function setWorkbenchCsrfRequired(required: boolean) {
  workbenchCsrfRequired = required;
}

export function isWorkbenchCsrfRequired() {
  return workbenchCsrfRequired;
}
