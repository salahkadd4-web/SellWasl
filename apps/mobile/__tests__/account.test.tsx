import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import ActivationScreen from '../app/activation';
import ChangePasswordScreen from '../app/change-password';
import { ApiClientError } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';

jest.mock('@/auth/AuthContext', () => ({ useAuth: jest.fn() }));

const withAuth = (value: Record<string, unknown>) =>
  jest.mocked(useAuth).mockReturnValue(value as unknown as ReturnType<typeof useAuth>);

/** Association du téléphone et mot de passe provisoire (UC-01, UC-80). */
describe('association du téléphone', () => {
  it('code de 8 caractères mis en forme, puis association', async () => {
    const activate = jest.fn().mockResolvedValue(undefined);
    withAuth({ activate, notice: null });
    await render(<ActivationScreen />);
    const code = screen.getByLabelText('Ou saisissez le code');
    await fireEvent.changeText(code, 'abcd');
    await fireEvent.press(screen.getByRole('button', { name: 'Associer ce téléphone' }));
    expect(await screen.findByText('Le code fait 8 caractères.')).toBeOnTheScreen();
    await fireEvent.changeText(code, 'abcd2345');
    expect(screen.getByLabelText('Ou saisissez le code').props.value).toBe('ABCD-2345');
    await fireEvent.changeText(screen.getByLabelText('Votre mot de passe'), 'SellWasl@2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Associer ce téléphone' }));
    await waitFor(() => expect(activate).toHaveBeenCalledWith('ABCD2345', 'SellWasl@2026'));
  });

  it('code refusé par le serveur : message de l’API', async () => {
    const activate = jest
      .fn()
      .mockRejectedValue(
        new ApiClientError(401, 'INVALID_ACTIVATION_CODE', 'Code invalide ou expiré.'),
      );
    withAuth({ activate, notice: null });
    await render(<ActivationScreen />);
    await fireEvent.changeText(screen.getByLabelText('Ou saisissez le code'), 'ABCD2345');
    await fireEvent.changeText(screen.getByLabelText('Votre mot de passe'), 'x');
    await fireEvent.press(screen.getByRole('button', { name: 'Associer ce téléphone' }));
    expect(await screen.findByText('Code invalide ou expiré.')).toBeOnTheScreen();
  });
});

describe('mot de passe provisoire (règle de la phase 27)', () => {
  async function setup() {
    const changePassword = jest.fn().mockResolvedValue(undefined);
    withAuth({ me: null, changePassword, logout: jest.fn() });
    await render(<ChangePasswordScreen />);
    const fill = async (current: string, next: string, confirm: string) => {
      await fireEvent.changeText(screen.getByLabelText('Mot de passe provisoire'), current);
      await fireEvent.changeText(
        screen.getByLabelText('Nouveau mot de passe (8 caractères, une lettre et un chiffre)'),
        next,
      );
      await fireEvent.changeText(
        screen.getByLabelText('Confirmez le nouveau mot de passe'),
        confirm,
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Enregistrer' }));
    };
    return { changePassword, fill };
  }

  it('mot de passe sans chiffre : refusé sur le téléphone', async () => {
    const { changePassword, fill } = await setup();
    await fill('ABCD-2345', 'abcdefgh', 'abcdefgh');
    expect(await screen.findByText('Au moins un chiffre')).toBeOnTheScreen();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('confirmation différente, puis enregistrement', async () => {
    const { changePassword, fill } = await setup();
    await fill('ABCD-2345', 'Solide2026', 'Solide2027');
    expect(
      await screen.findByText('Les deux nouveaux mots de passe sont différents.'),
    ).toBeOnTheScreen();
    await fill('ABCD-2345', 'Solide2026', 'Solide2026');
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('ABCD-2345', 'Solide2026'));
  });
});
