import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Listed, ShowMore } from './show-more';

/** Réponse de l'API simulée au niveau HTTP : le vrai client `api` lit le statut et l'erreur. */
function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** « Afficher plus » des listes paginées (phase 25). */
describe('ShowMore', () => {
  afterEach(() => vi.unstubAllGlobals());
  const list = (nextCursor: string | null): Listed<{ id: string }> => ({
    path: '/orders?date=2026-10-11',
    page: { data: [{ id: 'a' }, { id: 'b' }], nextCursor, total: 3 },
  });

  it('rien à la dernière page', () => {
    const { container } = render(<ShowMore list={list(null)} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('charge la page suivante avec le curseur et l’ajoute à la suite', async () => {
    const fetchMock = stubFetch(200, { data: [{ id: 'c' }], nextCursor: null, total: 3 });
    const onChange = vi.fn();
    render(<ShowMore list={list('cur/+=')} onChange={onChange} />);
    expect(screen.getByText('2 sur 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Afficher plus' }));
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/orders?date=2026-10-11&cursor=cur%2F%2B%3D');
    expect(onChange).toHaveBeenCalledWith({
      path: '/orders?date=2026-10-11',
      page: { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], nextCursor: null, total: 3 },
    });
  });

  it('erreur de chargement : message de l’API, la liste reste', async () => {
    stubFetch(500, { error: { code: 'INTERNAL_ERROR', message: 'Erreur inattendue.' } });
    const onChange = vi.fn();
    render(<ShowMore list={list('x')} onChange={onChange} scope="platform" />);
    await userEvent.click(screen.getByRole('button', { name: 'Afficher plus' }));
    expect(await screen.findByText('Erreur inattendue.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
