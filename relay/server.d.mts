export function createRelay(options?: {
  file?: string;
  invites?: string[];
  grant?: number;
  now?: () => number;
}): { handle: (req: any, res: any) => Promise<void>; db: any; sweep: () => void };
