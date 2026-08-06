import { startStack } from './stack';

export default async function globalSetup(): Promise<void> {
  await startStack();
}
