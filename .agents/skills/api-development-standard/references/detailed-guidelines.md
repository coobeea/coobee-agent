# Detailed API Development Guidelines

## Table of Contents

- [Anti-Patterns to Avoid](#anti-patterns-to-avoid)
- [Error Handling Best Practices](#error-handling-best-practices)
- [Parameter Validation](#parameter-validation)
- [HTTP Status Codes](#http-status-codes)
- [Type Safety Patterns](#type-safety-patterns)
- [Testing Guidelines](#testing-guidelines)

## Anti-Patterns to Avoid

### ❌ Using `any` Type

```typescript
// BAD
function maskData(config: any): any {
  return config;
}

// GOOD
function maskData(config: ProvidersConfig): ProvidersConfig {
  return config;
}
```

### ❌ Undefined Type Annotations

```typescript
// BAD
router.get('/users', async (ctx) => {
  ctx.body = { success: true, data: users };
});

// GOOD
router.get('/users', async (ctx) => {
  const response: ApiResponse<GetUsersRespVO> = {
    success: true,
    data: { users }
  };
  ctx.body = response;
});
```

### ❌ Duplicate Type Definitions

```typescript
// BAD - Frontend duplicates types
export interface User {
  id: string;
  name: string;
}

// GOOD - Import from shared
import type { UserVO } from '@shared/api/user-types';
export type { UserVO };
```

### ❌ Inconsistent Response Format

```typescript
// BAD
ctx.body = { data: user }; // Missing success field

// GOOD
const response: ApiResponse<GetUserRespVO> = {
  success: true,
  data: { user }
};
ctx.body = response;
```

## Error Handling Best Practices

### Proper Error Typing

```typescript
// GOOD
try {
  // Business logic
} catch (error) {
  log.error('[Routes] Error:', error);
  ctx.status = 500;
  
  const response: ApiResponse = {
    success: false,
    error: error instanceof Error ? error.message : String(error)
  };
  ctx.body = response;
}
```

### Specific Error Messages

```typescript
// GOOD
if (!user) {
  ctx.status = 404;
  const response: ApiResponse = {
    success: false,
    error: `User "${userId}" not found`
  };
  ctx.body = response;
  return;
}
```

### Error Codes (Optional)

```typescript
const response: ApiResponse = {
  success: false,
  error: 'Invalid credentials',
  code: 'AUTH_FAILED'
};
```

## Parameter Validation

### Early Validation

```typescript
router.post('/users', async (ctx) => {
  const body = ctx.request.body as Partial<CreateUserReqVO>;

  // Validate BEFORE business logic
  if (!body.name || !body.email) {
    ctx.status = 400;
    const response: ApiResponse = {
      success: false,
      error: 'name and email are required'
    };
    ctx.body = response;
    return;
  }

  // Business logic
  try {
    const user = await createUser(body);
    // ...
  }
});
```

### Type-Safe Validation

```typescript
// Extract required fields from VO type
const body = ctx.request.body as Partial<CreateUserReqVO>;

// TypeScript helps ensure all required fields are checked
if (!body.name || !body.email || !body.password) {
  // ...
}
```

## HTTP Status Codes

| Code | Usage | Example |
|------|-------|---------|
| 200 | Success | GET/POST/PATCH successful |
| 400 | Bad Request | Invalid parameters |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Unexpected error |

### Status Code Examples

```typescript
// 200 - Success (default)
ctx.body = { success: true, data: { user } };

// 400 - Bad Request
ctx.status = 400;
ctx.body = { success: false, error: 'Invalid parameters' };

// 404 - Not Found
ctx.status = 404;
ctx.body = { success: false, error: 'User not found' };

// 500 - Server Error
ctx.status = 500;
ctx.body = { success: false, error: 'Internal server error' };
```

## Type Safety Patterns

### Narrowing Request Body Types

```typescript
// Start with Partial for body validation
const body = ctx.request.body as Partial<CreateUserReqVO>;

// After validation, safe to use as full type
if (isValidCreateUserReq(body)) {
  const user = await createUser(body as CreateUserReqVO);
}
```

### Type Guards

```typescript
function isValidCreateUserReq(body: Partial<CreateUserReqVO>): body is CreateUserReqVO {
  return !!(body.name && body.email && body.password);
}
```

### Omit Pattern for Updates

```typescript
export interface UpdateUserReqVO {
  userId: string;
  updates: Partial<Omit<UserVO, 'id' | 'createdAt'>>;
}
```

## Testing Guidelines

### Backend Testing with curl

```bash
# Success case
curl http://localhost:8765/gateway/users/123

# Not found case
curl http://localhost:8765/gateway/users/nonexistent

# POST with data
curl -X POST http://localhost:8765/gateway/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","password":"123456"}'

# Invalid parameters
curl -X POST http://localhost:8765/gateway/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Test"}'  # Missing email and password
```

### Frontend Testing

```typescript
import { getUser, createUser } from '@/api/user';

// Test success case
const result = await getUser('123');
if (result.success && result.data) {
  console.log('User:', result.data.user);
}

// Test error case
const errorResult = await getUser('nonexistent');
if (!errorResult.success) {
  console.error('Error:', errorResult.error);
}
```

### Type Testing

```typescript
// Verify TypeScript provides correct types
const result = await getUser('123');

if (result.success && result.data) {
  // TypeScript knows result.data is GetUserRespVO
  const userName = result.data.user.name; // ✓ Type-safe
}
```

## Development Checklist

- [ ] Types defined in `src/shared/api/{module}-types.ts`
- [ ] Request/response types follow `XXXReqVO`/`XXXRespVO` pattern
- [ ] Backend route uses `ApiResponse<T>` for all responses
- [ ] Frontend client imports shared types
- [ ] No `any` types used
- [ ] Error handling uses `Error` type
- [ ] Parameters validated before business logic
- [ ] HTTP status codes set correctly
- [ ] Logs added for key operations
- [ ] `npm run typecheck` passes
- [ ] Tested with curl
- [ ] Documentation updated (optional)

## Best Practices Summary

1. **Type-first** - Define types before implementation
2. **Early validation** - Check parameters before business logic
3. **Consistent errors** - Use `Error` type, never `any`
4. **Proper status codes** - Match HTTP semantics
5. **Log operations** - Success and failure cases
6. **Test thoroughly** - Both success and error paths
7. **Type safety** - Let TypeScript catch errors
