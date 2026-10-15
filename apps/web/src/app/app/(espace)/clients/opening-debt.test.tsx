import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { OpeningDebt } from './opening-debt';

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  api: vi.fn(),
}));

/** Solde d'ouverture de la fiche client (BR-PAY-09). */
describe('OpeningDebt', () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it('modifiable : enregistre le montant, puis rend la fiche relue (nouvelle version)', async () => {
    const reloaded = { id: 'c1', version: 3, debtAmount: 12000 };
    vi.mocked(api)
      .mockResolvedValueOnce({ openingDebtAmount: 0, openingDebtEditable: true, debtAmount: 0 })
      .mockResolvedValueOnce({
        openingDebtAmount: 12000,
        openingDebtEditable: true,
        debtAmount: 12000,
      })
      .mockResolvedValueOnce(reloaded);
    const onSaved = vi.fn();
    render(<OpeningDebt customerId="c1" onSaved={onSaved} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    const input = screen.getByLabelText(/^Solde d’ouverture \(DA\)/);
    await userEvent.clear(input);
    await userEvent.type(input, '12 000');
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(api).toHaveBeenCalledWith('company', '/customers/c1/opening-debt', {
      method: 'PUT',
      body: JSON.stringify({ amount: 12000 }),
    });
    // La saisie change la version du client : la fiche est relue, sinon « Modifier » serait en conflit
    expect(api).toHaveBeenLastCalledWith('company', '/customers/c1');
    expect(onSaved).toHaveBeenCalledWith(reloaded);
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  });

  it('figé : pas de bouton, le gel est indiqué', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      openingDebtAmount: 5000,
      openingDebtEditable: false,
      debtAmount: 8000,
    });
    render(<OpeningDebt customerId="c1" onSaved={vi.fn()} />);
    expect(await screen.findByText(/figé/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Modifier' })).toBeNull();
  });
});
