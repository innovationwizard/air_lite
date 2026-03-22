# Frontend Setup Instructions

## ✅ Completed Setup

The following components have been configured and are ready to use:

- ✅ Next.js 14 with TypeScript
- ✅ Tailwind CSS with custom color palette
- ✅ Storybook for component development
- ✅ Jest + React Testing Library for testing
- ✅ Professional directory structure
- ✅ Example Button component with stories and tests

---

## 🚀 Quick Start

### 1. Create Environment File

```bash
# Create .env.local for development
cat > .env.local << EOF
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001/v1
EOF
```

For production, create `.env.production`:
```bash
NEXT_PUBLIC_API_BASE_URL=https://api.airefill.com/v1
```

### 2. Run Development Server

```bash
npm run dev
```

Visit: `http://localhost:3000`

### 3. Run Storybook

```bash
npm run storybook
```

Visit: `http://localhost:6006`

You should see the Button component with all its variants!

### 4. Run Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

---

## ✅ Verification Checklist

Run these commands to verify everything is working:

### Check 1: Build Success
```bash
npm run build
```
Expected: Build completes without errors

### Check 2: Tests Pass
```bash
npm test
```
Expected: `10 passed, 10 total` (Button component tests)

### Check 3: Storybook Runs
```bash
npm run storybook
```
Expected: Storybook starts on port 6006, shows Button stories

### Check 4: Linting Works
```bash
npm run lint
```
Expected: No errors (warnings are okay)

---

## 📁 What's Been Created

### Configuration Files
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `next.config.mjs` - Next.js configuration  
- `tailwind.config.ts` - Tailwind + custom theme
- `jest.config.mjs` - Jest testing configuration
- `jest.setup.js` - Test environment setup
- `.storybook/main.ts` - Storybook configuration
- `.storybook/preview.ts` - Storybook preview settings
- `components.json` - Shadcn/UI configuration

### Source Files
- `src/app/layout.tsx` - Root layout with Inter + Figtree fonts
- `src/app/globals.css` - Global styles with custom color palette
- `src/app/page.tsx` - Home page
- `src/lib/utils.ts` - Utility functions (cn, formatters)
- `src/components/ui/button.tsx` - Button component
- `src/components/ui/button.stories.tsx` - Button Storybook stories
- `src/components/ui/__tests__/button.test.tsx` - Button tests (10 tests)

---

## 🎨 Design System

### Colors
- **Primary**: `#2563EB` (Deep Blue)
- **Accent**: `#16A34A` (Success Green)
- **Neutral**: Slate palette (`#F8FAFC` to `#0F172A`)
- **Destructive**: Red for errors
- **Warning**: Amber for warnings

### Typography
- **Body**: Inter (400, 500, 600)
- **Headings**: Figtree (700)

### Component Variants
Button supports:
- **Variants**: default, destructive, outline, secondary, ghost, link
- **Sizes**: sm, default, lg, icon
- **States**: hover, focus, disabled

---

## 🧪 Testing

### Example Test File Structure
```
src/components/ui/
├── button.tsx              # Component
├── button.stories.tsx      # Storybook stories
└── __tests__/
    └── button.test.tsx     # Jest tests
```

### Writing Tests
```typescript
import { render, screen } from '@testing-library/react'
import { Button } from '../button'

test('renders button', () => {
  render(<Button>Click me</Button>)
  expect(screen.getByRole('button')).toBeInTheDocument()
})
```

### Writing Stories
```typescript
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './button'

const meta = {
  title: 'UI/Button',
  component: Button,
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {
  args: {
    children: 'Button',
  },
}
```

---

## 🐛 Troubleshooting

### Issue: Tests fail with "Cannot find module"
**Solution**: Check that `@/` path alias is working:
```json
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### Issue: Storybook doesn't show components
**Solution**: 
1. Check file naming: `*.stories.tsx`
2. Check story location: inside `src/`
3. Restart Storybook

### Issue: Tailwind classes not working
**Solution**: 
1. Verify `globals.css` is imported in `layout.tsx`
2. Check `tailwind.config.ts` content paths
3. Restart dev server

### Issue: Environment variables undefined
**Solution**: 
1. Create `.env.local` file
2. Prefix with `NEXT_PUBLIC_` for browser access
3. Restart dev server (required for new env vars)

---

## 📚 Next Steps

Now that the foundation is complete, you can:

1. **Add More Components**
   ```bash
   # Create new component in Storybook
   # 1. Create: src/components/ui/card.tsx
   # 2. Create: src/components/ui/card.stories.tsx
   # 3. Create: src/components/ui/__tests__/card.test.tsx
   # 4. Run: npm run storybook
   ```

2. **Build Authentication**
   - Create Zustand auth store
   - Build login page
   - Add middleware for protected routes

3. **Create Dashboard Components**
   - KPI cards
   - Data tables
   - Charts (Recharts)

4. **Build Role-Specific Dashboards**
   - Compras
   - Admin
   - Inventario
   - Finance
   - Ventas
   - Ejecutivo
   - SUPERUSER

---

## 🎯 Available Commands

```bash
npm run dev          # Start Next.js dev server (port 3000)
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm test             # Run Jest tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
npm run storybook    # Start Storybook (port 6006)
npm run build-storybook # Build Storybook static site
```

---

## ✅ Setup Status

**Status**: 🟢 **COMPLETE**

All foundation components are working:
- ✅ Next.js dev server starts
- ✅ Tests pass (10/10)
- ✅ Storybook runs
- ✅ TypeScript compiles
- ✅ Tailwind CSS works
- ✅ Components render correctly

**Ready for**: Component development and authentication implementation

---

## 📞 Support

If you encounter issues:
1. Check this troubleshooting guide
2. Verify all commands in "Verification Checklist"
3. Review the example Button component implementation
4. Check console for specific error messages

**Developer**: Jorge Luis Contreras Herrera  
**Last Updated**: October 10, 2025

