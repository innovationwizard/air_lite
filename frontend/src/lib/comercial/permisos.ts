/**
 * El área sobre la que puede escribir quien pide.
 *
 * Un jefe de canal escribe SÓLO la suya, y eso se decide contra su perfil, no
 * contra lo que mande en el cuerpo — si viniera del cuerpo, cualquiera con rol
 * `ventas` podría cargar cifras en nombre de otro canal. `admin` y `superuser`
 * sí pueden indicar el área, porque cargan en representación de alguien.
 *
 * Shared by the capture route and the lock route (2026-09-11): the rule that
 * decides whose forecast you may write is the rule that decides whose you may
 * freeze.
 */
export function areaPermitida(
  usuario: { role: string; area: string | null },
  areaPedida: unknown,
): { ok: true; area: string } | { ok: false; msg: string } {
  if (usuario.role === 'ventas') {
    if (!usuario.area) {
      return { ok: false, msg: 'Tu usuario no tiene un canal comercial asignado. Pedile a un administrador que te lo configure.' };
    }
    if (typeof areaPedida === 'string' && areaPedida !== usuario.area) {
      return { ok: false, msg: 'Sólo podés cargar el forecast de tu propio canal.' };
    }
    return { ok: true, area: usuario.area };
  }
  if (typeof areaPedida !== 'string' || !areaPedida.trim()) {
    return { ok: false, msg: 'area es obligatoria' };
  }
  return { ok: true, area: areaPedida };
}

/**
 * A parent area (one with children — institucional since 2026-09-11) is a
 * consolidated view: it captures nothing, locks nothing. The sellers do.
 */
export function esAreaPadre(areas: readonly { slug: string; padre?: string | null }[], area: string): boolean {
  return areas.some((a) => a.padre === area);
}
