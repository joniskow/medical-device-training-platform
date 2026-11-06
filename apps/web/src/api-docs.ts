type Operation = { summary: string; description?: string; parameters?: unknown[]; requestBody?: unknown; responses: unknown };
const operations = document.querySelector<HTMLElement>('#operations')!;
const status = document.querySelector<HTMLElement>('#status')!;
const filter = document.querySelector<HTMLInputElement>('#filter')!;
function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string) { const element = document.createElement(tag); element.textContent = text; return element; }
function detail(label: string, value: unknown) { const element = document.createElement('details'); element.append(textElement('summary', label), textElement('pre', JSON.stringify(value, null, 2))); return element; }
try {
  const response = await fetch('/api/v1/openapi.json', { credentials: 'omit', redirect: 'error' });
  if (!response.ok) throw new Error('Unavailable');
  const specification = await response.json() as { paths: Record<string, Record<string, Operation>>; components: { schemas: Record<string, unknown> } };
  for (const [path, methods] of Object.entries(specification.paths)) for (const [method, operation] of Object.entries(methods)) {
    const article = document.createElement('article');
    article.append(textElement('h2', `${method.toUpperCase()} ${path}`), textElement('p', operation.summary));
    if (operation.description) article.append(textElement('p', operation.description));
    if (operation.parameters?.length) article.append(detail('Parameters and headers', operation.parameters));
    if (operation.requestBody) article.append(detail('Request body', operation.requestBody));
    article.append(detail('Responses', operation.responses)); operations.append(article);
  }
  const schemas = document.querySelector<HTMLElement>('#schemas')!;
  schemas.append(textElement('h2', 'Data schemas'));
  for (const [name, schema] of Object.entries(specification.components.schemas)) schemas.append(detail(name, schema));
  filter.addEventListener('input', () => { let visible = 0; for (const article of operations.children) { const element = article as HTMLElement; element.hidden = !element.textContent?.toLowerCase().includes(filter.value.toLowerCase()); if (!element.hidden) visible++; } status.textContent = `${visible} endpoints shown.`; });
  status.textContent = `${operations.children.length} endpoints. Authentication: Bearer API access token.`;
} catch { status.textContent = 'API reference could not load. Refresh to retry.'; }
export {};
