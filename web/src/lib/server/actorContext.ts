import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { User } from '@prisma/client';

// Who is acting when there is no browser session: the MCP server authenticates a bearer token and runs
// the tool inside `withActor(user, ...)`, so `currentUser()` (and through it every admin guard and
// server action) sees that staff member. Only server code can enter this context; a request can never
// set it, so it cannot be used to impersonate anyone.

const store = new AsyncLocalStorage<User>();

export const withActor = <T,>(user: User, fn: () => Promise<T>): Promise<T> => store.run(user, fn);
export const injectedActor = (): User | undefined => store.getStore();
