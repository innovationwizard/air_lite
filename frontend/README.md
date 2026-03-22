# Artificial Intelligence Refill - Frontend

**AI Refill** Frontend Application

**Framework**: Next.js 14 with App Router  
**Language**: TypeScript  
**Styling**: Tailwind CSS + Shadcn/UI  
**State Management**: Zustand  
**Testing**: Jest + React Testing Library  
**Component Development**: Storybook  
**Charts**: Recharts  

---

## 🎯 Project Status

**Phase**: Step 3.2 - UI Development  
**Status**: ✅ Initial Setup Complete | 🚧 Components & Auth In Progress

### ✅ Completed (Sub-steps 3.2.1.1 - 3.2.1.6)
- [x] Next.js 14 project initialization with TypeScript
- [x] Professional directory structure (`app`, `components`, `lib`, `hooks`, `services`, `stores`, `types`)
- [x] Typography configuration (Inter + Figtree via `next/font`)
- [x] Custom color palette (Deep Blue + Slate + Green)
- [x] Tailwind CSS configuration with CSS variables
- [x] Environment variables setup (`.env.local`, `.env.production`)
- [x] ESLint configuration
- [x] Utility functions (`cn`, formatters)

### 🚧 In Progress
- [ ] Shadcn/UI component installation
- [ ] Storybook setup
- [ ] Jest + Testing Library configuration

### ⏳ Remaining (Sub-steps 3.2.2.x - 3.2.5.x)
- Authentication flow & session management
- Zustand auth store
- Protected route middleware
- UI component library (Button, Card, Table, Charts)
- Role-specific dashboards (7 roles)
- Docker + App Runner deployment
- CI/CD pipeline

---

## 🏗️ Project Structure

```
frontend/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx         # Root layout with fonts
│   │   ├── globals.css        # Global styles + color palette
│   │   └── page.tsx           # Home page
│   ├── components/
│   │   ├── ui/                # Shadcn/UI components
│   │   ├── dashboard/         # Dashboard components
│   │   └── charts/            # Chart components
│   ├── lib/
│   │   └── utils.ts           # Utility functions
│   ├── hooks/                 # Custom React hooks
│   ├── services/              # API services
│   ├── stores/                # Zustand stores
│   └── types/                 # TypeScript types
├── components.json            # Shadcn/UI configuration
├── tailwind.config.ts         # Tailwind configuration
├── next.config.mjs            # Next.js configuration
├── tsconfig.json              # TypeScript configuration
└── package.json               # Dependencies

```

---

## 🎨 Design System

### Colors

**Primary** (Deep Blue)
- Main: `#2563EB` (Blue 600)
- Usage: Primary buttons, active navigation, key highlights

**Neutral** (Slate)
- Background: `#F8FAFC` (Slate 50)
- Borders: `#E2E8F0` (Slate 200)
- Body Text: `#334155` (Slate 700)
- Headings: `#0F172A` (Slate 900)

**Accent** (Success Green)
- Main: `#16A34A` (Green 600)
- Usage: "Save", "Confirm", "Create" actions

**Feedback Colors**
- Error: Red for destructive actions
- Warning: Amber for non-critical alerts
- Info: Blue for informational tips

### Typography

**Body & UI**: Inter (400, 500, 600)
- Used for: Paragraph text, labels, UI elements

**Headings**: Figtree (700)
- Used for: H1, H2, H3, major headlines

### Component Patterns

- **KPI Cards**: Hover animation with shadow and lift
- **Status Indicators**: Color-coded badges (critical, warning, success, info)
- **Data Tables**: Sortable, filterable, paginated
- **Charts**: Responsive Recharts with consistent theming

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local and set NEXT_PUBLIC_API_BASE_URL

# Run development server
npm run dev
```

Visit `http://localhost:3000`

### Available Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode
npm run storybook    # Start Storybook (after setup)
```

---

## 📦 Dependencies

### Core
- **next**: 14.2.5 - React framework
- **react**: 18.3.1 - UI library
- **typescript**: 5.4.5 - Type safety

### State & Data
- **zustand**: 4.5.2 - State management
- **axios**: 1.7.2 - HTTP client

### UI & Styling
- **tailwindcss**: 3.4.4 - Utility-first CSS
- **shadcn/ui**: Components (Radix UI primitives)
- **lucide-react**: 0.378.0 - Icons
- **recharts**: 2.12.7 - Charts

### Testing & Development
- **jest**: 29.7.0 - Testing framework
- **@testing-library/react**: 15.0.7 - React testing utilities
- **storybook**: 8.1.6 - Component development

---

## 🧪 Testing

### Running Tests

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

### Testing Strategy

- **Unit Tests**: Individual components and utilities
- **Integration Tests**: Component interactions
- **E2E Tests** (future): Full user flows

---

## 📐 Architecture Decisions

### Why Next.js App Router?
- Server Components for better performance
- Built-in routing with loading and error states
- Simplified data fetching

### Why Zustand over Redux?
- Simpler API, less boilerplate
- Better TypeScript support
- Sufficient for our use case (auth state + UI state)

### Why Shadcn/UI?
- Copy-paste components (full control)
- Built on Radix UI (accessible primitives)
- Tailwind-based (consistent with our styling)

### Why Storybook?
- Component isolation for development
- Visual testing and documentation
- Shareable component library

### Why Recharts?
- React-first charting library
- Simple API, good TypeScript support
- Sufficient for our dashboard needs

---

## 🔐 Environment Variables

### Development (`.env.local`)
```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/v1
```

### Production (`.env.production`)
```bash
NEXT_PUBLIC_API_BASE_URL=https://api.airefill.com/v1
```

**Note**: All browser-accessible variables must be prefixed with `NEXT_PUBLIC_`

---

## 🎭 Role-Based Dashboards

### Landing Pages by Role

**SUPERUSER** (Developer)
- System status KPIs
- Live log feed
- Administrative shortcuts
- User impersonation

**Compras** (Purchasing)
- Personalized KPIs for segment
- Actionable recommendations table (top 5-10)
- Inventory level chart (top 10 critical SKUs)
- Quick links to PO creation

**Admin** (General Manager)
- Key business KPIs
- Embedded BI visuals from Metabase
- Alerts panel for delegation
- Quick links to full BI environment

**Ventas** (Sales)
- Personalized sales KPIs
- Demand forecast vs actuals chart
- Stock availability for top products
- Links to detailed reports

**Inventario** (Warehouse)
- Live logistics KPIs
- Action queues (arrivals/shipments today)
- Urgent alerts (discrepancies, delays)
- Quick links for stock management

**Ejecutivo** (CEO/PM)
- Executive KPIs (service level, working capital)
- Business unit health summary
- Financial trend charts
- One-click access to key reports

---

## 🚢 Deployment

### Docker Build

```bash
# Build Next.js for production
npm run build

# Docker build (uses standalone output)
docker build -t ai-refill-frontend .

# Run container
docker run -p 3000:3000 ai-refill-frontend
```

### AWS App Runner

Deployment is automated via GitHub Actions:
1. Push to `main` branch
2. CI/CD builds Docker image
3. Pushes to Amazon ECR
4. App Runner pulls and deploys

---

## 📚 Next Steps

### Immediate (Current Sprint)
1. **Complete Shadcn/UI setup** - Install Button, Card, Table components
2. **Set up Storybook** - Initialize and create first story
3. **Configure Jest** - Set up test environment
4. **Update Backend** - Add httpOnly cookie support
5. **Build Auth Flow** - Login page, Zustand store, middleware

### Short-term (Week 1-2)
6. **Component Library** - Build reusable UI components in Storybook
7. **Compras Dashboard** - First role-specific view
8. **Admin Dashboard** - User/role management UI

### Medium-term (Week 3-4)
9. **Remaining Dashboards** - Inventario, Finance, Ventas, Ejecutivo, SUPERUSER
10. **BI Integration** - Embed Metabase dashboards
11. **Export Features** - CSV/Excel/PDF download buttons

### Long-term (Month 2)
12. **E2E Tests** - Playwright or Cypress
13. **Performance Optimization** - Code splitting, image optimization
14. **Accessibility Audit** - WCAG 2.1 AA compliance

---

## 🤝 Contributing

This is a private commercial project. Development by invitation only.

---

## 📞 Support

**Developer**: Jorge Luis Contreras Herrera  
**Phase**: 3.2 (UI Development) - Initial Setup Complete  
**Status**: Ready for Component Development  
**Last Updated**: October 10, 2025

---

**Built with Next.js. Styled with Tailwind. Powered by TypeScript.**

