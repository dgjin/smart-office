# SmartOffice Codebase Instructions

## Architecture Overview

**Smart Office** is a Chinese-language office space management system (会议室预订 + 工位管理) built with React + TypeScript + Vite. It manages meeting rooms and desks with a sophisticated multi-level approval workflow integrated with Gemini AI for smart space recommendations.

### Key Data Flow
1. **Single-page state management**: All data lives in App.tsx component state, persisted to `localStorage` under key `SMART_OFFICE_DATA_V26`
2. **Approval pipeline**: Each booking passes through configurable `ApprovalNode` workflow (stored in `DEFAULT_WORKFLOW`). The booking's `currentNodeIndex` and `approvalHistory` track state
3. **AI integration**: `services/geminiService.ts` calls Gemini-3-Flash to analyze booking purpose and suggest best resources
4. **Role-based access**: Three predefined roles control UI visibility (SYSTEM_ADMIN, APPROVAL_ADMIN, EMPLOYEE); role colors come from `INITIAL_ROLES`

## Critical Patterns & Conventions

### Data Structures (types.ts)
- **Role**: String ID referring to RoleDefinition (not a full object)
- **User.role**: Array of role IDs (supports multiple roles)
- **Booking.status**: PENDING|APPROVED|REJECTED|COMPLETED|CANCELLED
- **Resource.status**: AVAILABLE|OCCUPIED|MAINTENANCE|PENDING
- Department tree structure uses `parentId` for hierarchy

### Component Organization
- All UI in `App.tsx` (monolithic by design) with helper components inside:
  - `StatusBadge()`, `RoleTag()`, `SidebarItem()` - reusable badges
  - `StatCard()` - dashboard statistics
  - `TodayResourceUsage()` - timeline visualization (08:00-20:00 hardcoded)
- Theme color system uses Tailwind classes dynamically: `bg-${theme}-50`, `text-${theme}-600` (theme passed as prop)

### Storage & Initialization
- LocalStorage pattern: Load on mount, save on every mutation
- Constants in `constants.tsx` provide demo data: `INITIAL_USERS`, `INITIAL_RESOURCES`, `INITIAL_DEPARTMENTS`, `DEFAULT_WORKFLOW`, `INITIAL_BOOKINGS`
- Language: Chinese throughout UI (role names, labels, timestamps)

### Gemini AI Integration (geminiService.ts)
- Function: `getSmartRecommendation(purpose: string, participants: number, availableResources: Resource[])`
- Uses environment variable `GEMINI_API_KEY` injected via Vite `define`
- Prompt template asks for 1-2 sentence Chinese explanation
- Error fallback: "AI 推荐服务目前不可用，请根据实际需要选择。"
- Called during booking creation form, displays recommendation inline

## Developer Workflows

### Local Development
```bash
npm install
# Set GEMINI_API_KEY in .env.local file
npm run dev  # Start Vite dev server on :3000
```

### Build & Deployment
```bash
npm run build    # Generates dist/ with optimized bundle
npm run preview  # Preview production build locally
```

### Key Files by Purpose
- **App.tsx**: Main component (1442 lines); handles state, all views, forms
- **types.ts**: Complete TypeScript interfaces (User, Resource, Booking, etc.)
- **constants.tsx**: Demo data seeds and default workflow definition
- **services/geminiService.ts**: Single external API integration
- **vite.config.ts**: Defines environment variable injection, port 3000, React plugin

## Critical Integration Points

### Approval Workflow
- Edit `DEFAULT_WORKFLOW` array in constants.tsx to change approval stages
- Each ApprovalNode requires `approverRole` (must exist in INITIAL_ROLES)
- Booking tracks position with `currentNodeIndex` and history in `approvalHistory`

### Environment Configuration
- `.env.local` must contain `GEMINI_API_KEY` (no default)
- Vite config exposes as `process.env.API_KEY` (note: both API_KEY and GEMINI_API_KEY defined)
- Build will fail silently if API key invalid

### LocalStorage Key
- Change `STORAGE_KEY = 'SMART_OFFICE_DATA_V26'` if migrating data schema
- All state saved as JSON: users, resources, bookings, departments, roles, workflow

## Project-Specific Gotchas

1. **Tailwind dynamic class generation**: Classes like `bg-${theme}-50` don't work in Tailwind unless listed explicitly. Supports: indigo, amber, emerald, rose, gray only
2. **Timezone**: Dates stored as ISO strings; TodayResourceUsage hardcodes 08:00-20:00 range
3. **Role array**: Users have `role: Role[]` (plural), but logic often checks first element
4. **Monolithic component**: App.tsx is the only main component. Refactoring to smaller files requires lifting state management
5. **Chinese month/calendar**: Date formatting uses Chinese month names ("1月", "2月", etc.)
6. **No backend**: All data transient except localStorage; no API calls except Gemini

## Adding Features

- **New role**: Add to `INITIAL_ROLES` in constants.tsx, reference by id
- **New workflow stage**: Add ApprovalNode to `DEFAULT_WORKFLOW`, adjust booking approval logic in App.tsx
- **New resource/user fields**: Update types.ts interface, INITIAL data arrays, and form sections in App.tsx
- **AI recommendation tuning**: Modify prompt in geminiService.ts `generateContent()` call
