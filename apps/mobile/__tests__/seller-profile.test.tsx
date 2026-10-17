import { render, screen } from '@testing-library/react-native';
import ProfileScreen from '../app/seller/profile';
import { useAuth } from '@/auth/AuthContext';

jest.mock('@/auth/AuthContext', () => ({ useAuth: jest.fn() }));

/**
 * Profil du vendeur : l'essentiel seulement. Les photos du catalogue se mettent à jour seules à
 * l'ouverture de session ; l'imprimante se choisit dans « Bons du jour ».
 */
describe('profil du vendeur', () => {
  beforeEach(() => {
    jest.mocked(useAuth).mockReturnValue({
      me: {
        user: { code: 'V07', firstName: 'Ahmed', lastName: 'Kaci' },
        role: { code: 'PRE_VENDEUR', name: 'Pré-vendeur' },
        company: { name: 'Distri Oran' },
      },
      profile: { series: 'A1B2' },
      offline: false,
      logout: jest.fn(),
    } as unknown as ReturnType<typeof useAuth>);
  });

  it('identité, connexion et déconnexion ; ni photos du catalogue ni test d’imprimante', async () => {
    await render(<ProfileScreen />);
    expect(screen.getByText('Ahmed Kaci')).toBeOnTheScreen();
    expect(screen.getByText('Code : V07')).toBeOnTheScreen();
    expect(screen.getByText('Entreprise : Distri Oran')).toBeOnTheScreen();
    expect(screen.getByText('En ligne')).toBeOnTheScreen();
    expect(screen.getByText('Déconnexion')).toBeOnTheScreen();
    expect(screen.queryByText('Photos du catalogue')).toBeNull();
    expect(screen.queryByText('Mettre à jour les photos')).toBeNull();
    expect(screen.queryByText("Tester l'imprimante")).toBeNull();
  });
});
