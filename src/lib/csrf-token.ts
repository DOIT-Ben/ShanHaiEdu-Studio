let workbenchCsrfToken: string | null = null;

export function setWorkbenchCsrfToken(token: string | null) {
  workbenchCsrfToken = token;
}

export function getWorkbenchCsrfToken() {
  return workbenchCsrfToken;
}
