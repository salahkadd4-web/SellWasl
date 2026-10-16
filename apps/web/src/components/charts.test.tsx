import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrendChart } from './charts';

const format = (n: number) => `${n} DA`;

/** Courbe de la page Statistiques : une ou plusieurs séries, survol, valeurs lisibles. */
describe('TrendChart', () => {
  it('une série : pas de légende ; survol d’une période : sa valeur', () => {
    render(
      <TrendChart
        title="Chiffre d'affaires"
        labels={['01/10', '02/10', '03/10']}
        series={[
          { key: 'ca', label: "Chiffre d'affaires", tone: 'primary', values: [100, 0, 300] },
        ]}
        format={format}
      />,
    );
    expect(screen.queryByRole('list', { name: 'Légende' })).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId('trend-hit-2'));
    const tooltip = screen.getByRole('status');
    expect(within(tooltip).getByText('03/10')).toBeInTheDocument();
    expect(within(tooltip).getByText('300 DA')).toBeInTheDocument();
  });

  it('plusieurs séries : légende, tableau des valeurs, précision au survol', () => {
    render(
      <TrendChart
        title="Retours"
        labels={['01/10', '02/10']}
        series={[
          { key: 'refused', label: 'Refusé', tone: 'danger', values: [500, 0] },
          {
            key: 'returned',
            label: 'Retourné',
            tone: 'warning',
            dash: 'dashed',
            values: [300, 50],
          },
        ]}
        format={format}
        detail={(i) => (i === 0 ? 'Taux de refus : 20 %' : null)}
      />,
    );
    const legend = screen.getByRole('list', { name: 'Légende' });
    expect(within(legend).getByText('Refusé')).toBeInTheDocument();
    expect(within(legend).getByText('Retourné')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('500 DA')).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByTestId('trend-hit-0'));
    expect(
      within(screen.getByRole('status')).getByText('Taux de refus : 20 %'),
    ).toBeInTheDocument();
  });

  it('rien sur la période : message, pas de courbe', () => {
    render(
      <TrendChart
        title="Chiffre d'affaires"
        labels={['01/10', '02/10']}
        series={[{ key: 'ca', label: "Chiffre d'affaires", tone: 'primary', values: [0, 0] }]}
        format={format}
      />,
    );
    expect(screen.getByText('Pas de données sur la période.')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
