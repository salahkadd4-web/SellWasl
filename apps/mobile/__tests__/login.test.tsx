import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import LoginScreen from '../app/login';
import { ApiClientError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

jest.mock('@/auth/AuthContext', () => ({ useAuth: jest.fn() }));

const auth = (login: jest.Mock) =>
  jest.mocked(useAuth).mockReturnValue({
    profile: {
      userCode: 'V07',
      firstName: 'Ahmed',
      lastName: 'Kaci',
      companyName: 'Distri Oran',
      roleName: 'Pré-vendeur',
      series: 'A1',
    },
    login,
    forgetDevice: jest.fn(),
    notice: null,
  } as unknown as ReturnType<typeof useAuth>);

/** Connexion sur le téléphone associé (BR-USR-06). */
describe('connexion', () => {
  it('salue l’utilisateur du téléphone et demande le mot de passe', async () => {
    const login = jest.fn();
    auth(login);
    await render(<LoginScreen />);
    expect(screen.getByText('Bonjour Ahmed')).toBeOnTheScreen();
    expect(screen.getByText('V07 · Pré-vendeur · Distri Oran')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByText('Saisissez votre mot de passe.')).toBeOnTheScreen();
    expect(login).not.toHaveBeenCalled();
  });

  it('envoie le mot de passe ; affiche le refus de l’API', async () => {
    const login = jest
      .fn()
      .mockRejectedValue(new ApiClientError(401, 'INVALID_CREDENTIALS', 'Mot de passe incorrect.'));
    auth(login);
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Mot de passe'), 'SellWasl@2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Se connecter' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('SellWasl@2026'));
    expect(await screen.findByText('Mot de passe incorrect.')).toBeOnTheScreen();
  });
});
