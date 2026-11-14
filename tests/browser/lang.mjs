// Browser-Tests laufen mit deutscher Oberfläche, unabhängig von der Sprache des Test-Chromes.
export async function deutsch(page) {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'languages', { get: () => ['de-DE', 'de'] });
    Object.defineProperty(navigator, 'language', { get: () => 'de-DE' });
  });
  return page;
}
