# Complete API Development Examples

## Example 1: Simple CRUD API (User Management)

### Type Definition (`src/shared/api/user-types.ts`)

```typescript
/**
 * User Management API Types
 */
import type { ApiResponse } from '@shared/api';
export type { ApiResponse };

// ==================== Business Types ====================

export interface UserVO {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: string;
}

// ==================== API Types ====================

/**
 * GET /users
 * List all users
 */
export interface ListUsersReqVO {
  page?: number;
  limit?: number;
}

export interface ListUsersRespVO {
  users: UserVO[];
  total: number;
  page: number;
  limit: number;
}

/**
 * GET /users/:id
 * Get user by ID
 */
export interface GetUserReqVO {
  userId: string; // From URL params
}

export interface GetUserRespVO {
  user: UserVO;
}

/**
 * POST /users
 * Create user
 */
export interface CreateUserReqVO {
  name: string;
  email: string;
  password: string;
  role?: 'admin' | 'user';
}

export interface CreateUserRespVO {
  userId: string;
  user: UserVO;
}

/**
 * PATCH /users/:id
 * Update user
 */
export interface UpdateUserReqVO {
  userId: string; // From URL params
  updates: Partial<Omit<UserVO, 'id' | 'createdAt'>>;
}

export interface UpdateUserRespVO {
  user: UserVO;
}

/**
 * DELETE /users/:id
 * Delete user
 */
export interface DeleteUserReqVO {
  userId: string; // From URL params
}

export interface DeleteUserRespVO {
  // Empty response
}
```

### Backend Routes (`src/main/routes/UserRoutes.ts`)

```typescript
/**
 * User Management HTTP Routes
 */
import type Router from '@koa/router';
import { log } from '@main/common/logger';
import type {
  ApiResponse,
  ListUsersReqVO,
  ListUsersRespVO,
  GetUserReqVO,
  GetUserRespVO,
  CreateUserReqVO,
  CreateUserRespVO,
  UpdateUserReqVO,
  UpdateUserRespVO,
  DeleteUserReqVO
} from '@shared/api/user-types';

// Mock database (replace with actual implementation)
const db = {
  users: new Map<string, any>(),
  
  listUsers: async (page: number, limit: number) => {
    const users = Array.from(db.users.values());
    const start = (page - 1) * limit;
    const end = start + limit;
    return {
      users: users.slice(start, end),
      total: users.length
    };
  },
  
  getUserById: async (id: string) => db.users.get(id),
  
  createUser: async (data: any) => {
    const id = Date.now().toString();
    const user = { ...data, id, createdAt: new Date().toISOString() };
    db.users.set(id, user);
    return user;
  },
  
  updateUser: async (id: string, updates: any) => {
    const user = db.users.get(id);
    if (!user) return null;
    const updated = { ...user, ...updates };
    db.users.set(id, updated);
    return updated;
  },
  
  deleteUser: async (id: string) => {
    return db.users.delete(id);
  }
};

export function registerUserRoutes(router: Router): void {
  // ==================== LIST ====================
  
  router.get('/users', async (ctx) => {
    const query = ctx.query as Partial<ListUsersReqVO>;
    const page = parseInt(String(query.page || '1'), 10);
    const limit = parseInt(String(query.limit || '10'), 10);

    try {
      const { users, total } = await db.listUsers(page, limit);
      
      const response: ApiResponse<ListUsersRespVO> = {
        success: true,
        data: { users, total, page, limit }
      };
      ctx.body = response;
      
    } catch (error) {
      log.error('[UserRoutes] Failed to list users:', error);
      ctx.status = 500;
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      ctx.body = response;
    }
  });

  // ==================== GET ====================
  
  router.get('/users/:id', async (ctx) => {
    const userId = ctx.params.id;

    try {
      const user = await db.getUserById(userId);
      
      if (!user) {
        ctx.status = 404;
        const response: ApiResponse = {
          success: false,
          error: `User "${userId}" not found`
        };
        ctx.body = response;
        return;
      }

      const response: ApiResponse<GetUserRespVO> = {
        success: true,
        data: { user }
      };
      ctx.body = response;
      
    } catch (error) {
      log.error(`[UserRoutes] Failed to get user ${userId}:`, error);
      ctx.status = 500;
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      ctx.body = response;
    }
  });

  // ==================== CREATE ====================
  
  router.post('/users', async (ctx) => {
    const body = ctx.request.body as Partial<CreateUserReqVO>;

    // Validate parameters
    if (!body.name || !body.email || !body.password) {
      ctx.status = 400;
      
      const response: ApiResponse = {
        success: false,
        error: 'name, email, and password are required'
      };
      ctx.body = response;
      return;
    }

    try {
      const user = await db.createUser({
        name: body.name,
        email: body.email,
        role: body.role || 'user'
      });

      log.info(`[UserRoutes] Created user: ${user.id}`);
      
      const response: ApiResponse<CreateUserRespVO> = {
        success: true,
        data: { userId: user.id, user }
      };
      ctx.body = response;
      
    } catch (error) {
      log.error('[UserRoutes] Failed to create user:', error);
      ctx.status = 500;
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      ctx.body = response;
    }
  });

  // ==================== UPDATE ====================
  
  router.patch('/users/:id', async (ctx) => {
    const userId = ctx.params.id;
    const body = ctx.request.body as Partial<UpdateUserReqVO['updates']>;

    if (!body || Object.keys(body).length === 0) {
      ctx.status = 400;
      
      const response: ApiResponse = {
        success: false,
        error: 'updates are required'
      };
      ctx.body = response;
      return;
    }

    try {
      const user = await db.updateUser(userId, body);
      
      if (!user) {
        ctx.status = 404;
        const response: ApiResponse = {
          success: false,
          error: `User "${userId}" not found`
        };
        ctx.body = response;
        return;
      }

      log.info(`[UserRoutes] Updated user: ${userId}`);
      
      const response: ApiResponse<UpdateUserRespVO> = {
        success: true,
        data: { user }
      };
      ctx.body = response;
      
    } catch (error) {
      log.error(`[UserRoutes] Failed to update user ${userId}:`, error);
      ctx.status = 500;
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      ctx.body = response;
    }
  });

  // ==================== DELETE ====================
  
  router.delete('/users/:id', async (ctx) => {
    const userId = ctx.params.id;

    try {
      const deleted = await db.deleteUser(userId);
      
      if (!deleted) {
        ctx.status = 404;
        const response: ApiResponse = {
          success: false,
          error: `User "${userId}" not found`
        };
        ctx.body = response;
        return;
      }

      log.info(`[UserRoutes] Deleted user: ${userId}`);
      
      const response: ApiResponse = {
        success: true
      };
      ctx.body = response;
      
    } catch (error) {
      log.error(`[UserRoutes] Failed to delete user ${userId}:`, error);
      ctx.status = 500;
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      ctx.body = response;
    }
  });

  log.info('[UserRoutes] HTTP routes registered');
}
```

### Frontend Client (`src/renderer/src/api/user.ts`)

```typescript
/**
 * User Management API Client
 */
import type {
  ApiResponse,
  UserVO,
  ListUsersReqVO,
  ListUsersRespVO,
  GetUserRespVO,
  CreateUserReqVO,
  CreateUserRespVO,
  UpdateUserReqVO,
  UpdateUserRespVO
} from '@shared/api/user-types';

const BASE_URL = 'http://localhost:8765/gateway';

export type { UserVO };

/**
 * List all users
 */
export async function listUsers(req?: ListUsersReqVO): Promise<ApiResponse<ListUsersRespVO>> {
  const params = new URLSearchParams();
  if (req?.page) params.set('page', String(req.page));
  if (req?.limit) params.set('limit', String(req.limit));
  
  const url = `${BASE_URL}/users${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url);
  return response.json();
}

/**
 * Get user by ID
 */
export async function getUser(userId: string): Promise<ApiResponse<GetUserRespVO>> {
  const response = await fetch(`${BASE_URL}/users/${userId}`);
  return response.json();
}

/**
 * Create user
 */
export async function createUser(req: CreateUserReqVO): Promise<ApiResponse<CreateUserRespVO>> {
  const response = await fetch(`${BASE_URL}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  });
  return response.json();
}

/**
 * Update user
 */
export async function updateUser(userId: string, updates: UpdateUserReqVO['updates']): Promise<ApiResponse<UpdateUserRespVO>> {
  const response = await fetch(`${BASE_URL}/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  return response.json();
}

/**
 * Delete user
 */
export async function deleteUser(userId: string): Promise<ApiResponse> {
  const response = await fetch(`${BASE_URL}/users/${userId}`, {
    method: 'DELETE'
  });
  return response.json();
}
```

## Testing the Example

### Backend Tests

```bash
# List users
curl http://localhost:8765/gateway/users

# Get user
curl http://localhost:8765/gateway/users/123

# Create user
curl -X POST http://localhost:8765/gateway/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"secret123"}'

# Update user
curl -X PATCH http://localhost:8765/gateway/users/123 \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Updated"}'

# Delete user
curl -X DELETE http://localhost:8765/gateway/users/123
```

### Frontend Usage

```typescript
import { listUsers, getUser, createUser, updateUser, deleteUser } from '@/api/user';

// List users
const result = await listUsers({ page: 1, limit: 10 });
if (result.success && result.data) {
  console.log(`Found ${result.data.total} users`);
  result.data.users.forEach(user => console.log(user.name));
}

// Create user
const createResult = await createUser({
  name: 'Bob',
  email: 'bob@example.com',
  password: 'secret456'
});

if (createResult.success && createResult.data) {
  console.log(`Created user: ${createResult.data.userId}`);
}

// Update user
await updateUser('123', { name: 'Bob Updated' });

// Delete user
await deleteUser('123');
```
