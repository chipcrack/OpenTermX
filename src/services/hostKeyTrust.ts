import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { createHostKeyInvoker, type HostKeyNotice } from './hostKeyProtocol';

interface TrustRequest {
  notice: HostKeyNotice;
  resolve: (accepted: boolean) => void;
}

export const useHostKeyRequests = create<{ requests: TrustRequest[] }>(() => ({ requests: [] }));

export function answerHostKeyRequest(accepted: boolean) {
  const [request, ...remaining] = useHostKeyRequests.getState().requests;
  if (!request) return;
  useHostKeyRequests.setState({ requests: remaining });
  request.resolve(accepted);
}

export const invokeWithHostKeyVerification = createHostKeyInvoker(invoke, (notice) =>
  new Promise<boolean>((resolve) => {
    useHostKeyRequests.setState((state) => ({ requests: [...state.requests, { notice, resolve }] }));
  })
);
