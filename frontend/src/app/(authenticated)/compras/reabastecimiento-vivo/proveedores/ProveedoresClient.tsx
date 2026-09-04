'use client';

import { useRouter } from 'next/navigation';
import { ProveedorGruposPanel } from '../ProveedorGruposPanel';

/**
 * Thin wrapper so the existing modal-shaped ProveedorGruposPanel (unchanged)
 * can be this page's whole content — "closing" it here means navigating back
 * to the live page instead of unmounting a piece of local state.
 */
export function ProveedoresClient() {
  const router = useRouter();
  return <ProveedorGruposPanel onClose={() => router.push('/compras/reabastecimiento-vivo')} />;
}
