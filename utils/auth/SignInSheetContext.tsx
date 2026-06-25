import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

// FOSS placeholder: cloud builds replace this with the real sign-in sheet.
// Public builds expose the same hook but opening sign-in is a no-op.

type SignInSheetContextValue = {
  openSignIn: (returnPath?: string) => void;
  closeSignIn: () => void;
};

const SignInSheetContext = createContext<SignInSheetContextValue | undefined>(undefined);

export function SignInSheetProvider({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({ openSignIn: () => undefined, closeSignIn: () => undefined }),
    []
  );
  return <SignInSheetContext.Provider value={value}>{children}</SignInSheetContext.Provider>;
}

export const useSignInSheet = () => {
  const context = useContext(SignInSheetContext);
  if (!context) throw new Error('useSignInSheet must be used within a SignInSheetProvider');
  return context;
};
