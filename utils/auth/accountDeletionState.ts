let deletingAccount = false;

export const setAccountDeletionInProgress = (value: boolean) => {
  deletingAccount = value;
};

export const isAccountDeletionInProgress = () => deletingAccount;
