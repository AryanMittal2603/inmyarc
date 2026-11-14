import { PasscodeProvider } from './context/passcode';
import { ToastProvider } from './context/toast';
import { Board } from './pages/Board';
import { Rating } from './pages/Rating';

/** Two screens, picked by path: "/rating" is the admin page, everything else is the board. */
export function App() {
  const isRating = window.location.pathname.replace(/\/+$/, '') === '/rating';
  return (
    <PasscodeProvider>
      <ToastProvider>{isRating ? <Rating /> : <Board />}</ToastProvider>
    </PasscodeProvider>
  );
}
