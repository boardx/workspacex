/** Full-page navigation keeps hosted payment flows independent of popup permissions. */
export function navigateToStripe(url: string): void {
  window.location.assign(url);
}
