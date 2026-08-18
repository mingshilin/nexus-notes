import { showErrorToast, showSuccessToast } from "@/lib/toastCategories";

export interface MutationRunnerOptions<T> {
  successMessage?: string | ((result: T) => string | null | undefined);
  errorMessage?: string;
  showErrorToast?: boolean;
  rollback?: (error: unknown) => void | Promise<void>;
}

export type MutationRunner = <T>(
  key: string,
  task: () => Promise<T>,
  options?: MutationRunnerOptions<T>,
) => Promise<T>;

interface MutationRunnerParams {
  pendingMutations: string[];
  setPendingMutation: (key: string, pending: boolean) => void;
}

export function useMutationRunner({ pendingMutations, setPendingMutation }: MutationRunnerParams) {
  function isMutationPending(key: string) {
    return pendingMutations.includes(key);
  }

  async function runMutation<T>(
    key: string,
    task: () => Promise<T>,
    options: MutationRunnerOptions<T> = {},
  ) {
    if (isMutationPending(key)) throw new Error("操作正在处理中，请稍候");
    setPendingMutation(key, true);
    try {
      const result = await task();
      const successMessage =
        typeof options.successMessage === "function"
          ? options.successMessage(result)
          : options.successMessage;
      if (successMessage) showSuccessToast(successMessage);
      return result;
    } catch (error) {
      if (options.rollback) await options.rollback(error);
      if (options.showErrorToast !== false) {
        showErrorToast(error, options.errorMessage ?? "操作失败");
      }
      throw error;
    } finally {
      setPendingMutation(key, false);
    }
  }

  return { isMutationPending, runMutation };
}
