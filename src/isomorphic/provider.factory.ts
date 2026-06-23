import { Capacitor } from '@capacitor/core';
import type { LlmProvider } from './provider.interface';
import { NativeProvider } from './provider.native';
import { WebProvider } from './provider.web';

export function createLlmProvider(): LlmProvider {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios' || platform === 'android') {
    return new NativeProvider();
  }
  return new WebProvider();
}

