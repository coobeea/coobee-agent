---
name: API Development Standard
description: Standard workflow for developing HTTP REST APIs in the coobee-agent project. Use when creating new API endpoints, modifying existing APIs, or implementing request/response handlers. Enforces type-safe API development with shared type definitions (XXXReqVO/XXXRespVO pattern), unified response format (ApiResponse<T>), and proper directory structure (shared/api/ for types, main/routes/ for backend, renderer/src/api/ for frontend).
---

# API Development Standard

Standard workflow for developing type-safe HTTP REST APIs in the coobee-agent project.

## Core Principles

1. **Type-first development** - Define types before implementation
2. **Shared types** - Types live in `src/shared/api/`, used by both frontend and backend
3. **Naming convention** - Use `XXXReqVO` / `XXXRespVO` for request/response types
4. **Unified response** - All APIs return `ApiResponse<T>` from `@shared/api`
5. **No `any` types** - Always use explicit type definitions

## Directory Structure

```
src/
├── shared/api/              # Shared type definitions
│   ├── config-types.ts      # Config API types (reference example)
│   └── {module}-types.ts    # New module types
├── main/routes/             # Backend HTTP routes
│   └── {Module}Routes.ts    # New route file
└── renderer/src/api/        # Frontend API clients
    └── {module}.ts          # New client file
```

## 5-Step Development Workflow

### Step 1: Define Types in `src/shared/api/{module}-types.ts`

```typescript
/**
 * {Module} API Types
 */
import type { ApiResponse } from '@shared/api';
export type { ApiResponse };

// Business types
export interface {Resource}VO {
  id: string;
  name: string;
  // ...
}

// API Request/Response types
export interface Get{Resource}ReqVO {
  {resource}Id: string; // From URL params
}

export interface Get{Resource}RespVO {
  {resource}: {Resource}VO;
}
```

**Naming:**
- Request: `{Action}{Resource}ReqVO`
- Response: `{Action}{Resource}RespVO`
- Business: `{Name}VO`

### Step 2: Implement Backend Route in `src/main/routes/{Module}Routes.ts`

```typescript
import type Router from '@koa/router';
import { log } from '@main/common/logger';
import type { ApiResponse, Get{Resource}RespVO } from '@shared/api/{module}-types';

export function register{Module}Routes(router: Router): void {
  router.get('/{resources}/:id', async (ctx) => {
    const {resource}Id = ctx.params.id;

    try {
      const {resource} = await get{Resource}ById({resource}Id);
      
      if (!{resource}) {
        ctx.status = 404;
        const response: ApiResponse = {
          success: false,
          error: '{Resource} not found'
        };
        ctx.body = response;
        return;
      }

      const response: ApiResponse<Get{Resource}RespVO> = {
        success: true,
        data: { {resource} }
      };
      ctx.body = response;
      
    } catch (error) {
      log.error('[{Module}Routes] Error:', error);
      ctx.status = 500;
      
      const response: ApiResponse = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      ctx.body = response;
    }
  });

  log.info('[{Module}Routes] HTTP routes registered');
}
```

**Backend checklist:**
- ✅ Use `ApiResponse<T>` for all responses
- ✅ Set `success: true/false` consistently
- ✅ Use proper HTTP status codes (200/400/404/500)
- ✅ Handle errors with `Error` type, never `any`
- ✅ Validate parameters before business logic
- ✅ Log operations (success and failure)

### Step 3: Implement Frontend Client in `src/renderer/src/api/{module}.ts`

```typescript
import type {
  ApiResponse,
  {Resource}VO,
  Get{Resource}RespVO
} from '@shared/api/{module}-types';

const BASE_URL = 'http://localhost:8765/gateway';

export type { {Resource}VO };

export async function get{Resource}({resource}Id: string): Promise<ApiResponse<Get{Resource}RespVO>> {
  const response = await fetch(`${BASE_URL}/{resources}/${${resource}Id}`);
  return response.json();
}
```

### Step 4: Type Check

```bash
npm run typecheck
```

Verify:
- ✅ No type errors
- ✅ No `any` type warnings
- ✅ No unused imports

### Step 5: Test

```bash
# Backend test
curl http://localhost:8765/gateway/{resources}/123

# Frontend test
const result = await get{Resource}('123');
```

## Response Format

### Success
```json
{
  "success": true,
  "data": { /* response data */ }
}
```

### Error
```json
{
  "success": false,
  "error": "Error message"
}
```

## Common Patterns

**Multiple items:**
```typescript
export interface List{Resources}RespVO {
  {resources}: {Resource}VO[];
  total: number;
}
```

**Create operation:**
```typescript
export interface Create{Resource}ReqVO {
  name: string;
  // ... other fields
}

export interface Create{Resource}RespVO {
  {resource}Id: string;
  {resource}: {Resource}VO;
}
```

**Update operation:**
```typescript
export interface Update{Resource}ReqVO {
  {resource}Id: string;
  updates: Partial<Omit<{Resource}VO, 'id'>>;
}
```

## Reference Examples

See complete implementations:
- **Types**: `src/shared/api/config-types.ts`
- **Backend**: `src/main/routes/ConfigRoutes.ts`
- **Frontend**: `src/renderer/src/api/config.ts`

## Detailed Guidelines

For comprehensive guidelines including anti-patterns, validation examples, and edge cases, see:
- [references/detailed-guidelines.md](references/detailed-guidelines.md)
- [references/examples.md](references/examples.md)
