/**
 * La cuenta detrás de cada encabezado de la página en vivo (Reyma y Carvajal
 * comparten la pantalla). El texto describe la fórmula que el motor corre,
 * igual para todos los productos: un clic en el encabezado no elige una fila.
 *
 * Una columna es cálculo (`formula` + `terminos`) o procedencia (`origen`).
 * No las dos. El redondeo, donde se nombra, es el de Excel: al entero, y la
 * mitad se aleja de cero.
 */

export interface TerminoColumna {
  nombre: string;
  cuenta: string;
}

export interface ExplicacionColumna {
  titulo: string;
  formula: string | null;
  terminos: readonly TerminoColumna[];
  origen: string | null;
}

function calculo(
  titulo: string,
  formula: string,
  terminos: readonly TerminoColumna[],
): ExplicacionColumna {
  return { titulo, formula, terminos, origen: null };
}

function dato(titulo: string, origen: string): ExplicacionColumna {
  return { titulo, formula: null, terminos: [], origen };
}

const SEMANAS = '4.2857, que es 30 ÷ 7: las semanas de un mes de treinta días.';

export const EXPLICACIONES = {
  codigo: dato(
    'Código',
    'El código de producto de Plasticentro, el mismo de Odoo. En Cumplimiento, un código que empieza por «odoo:» es una línea de la orden que está fuera del alcance del modelo.',
  ),
  clave: dato(
    'Clave',
    'La clave del proveedor. Es la que viaja en la factura y en la hoja que se le manda a planta.',
  ),
  descripcion: dato(
    'Descripción',
    'En el Modelo, el pedido, el cumplimiento y la nota de crédito se muestra la descripción de compra, y si viene vacía, el nombre del producto en Odoo. En el MRP semanal la columna es siempre el nombre de Odoo.',
  ),
  categoria: dato(
    'Categoría',
    'El campo Material de Odoo. Si ese campo está vacío, la celda usa la categoría del Excel de respaldo y lo marca con «xlsx».',
  ),
  precioUsd: dato(
    'Precio USD',
    'El precio de compra vigente, en dólares por caja. En el Modelo se edita y se guarda al salir de la celda. Ese precio es el que compara las facturas y el que usa la nota de crédito.',
  ),

  'stock.sj': dato(
    'San José',
    'Existencias en la bodega San José, en la unidad de stock del producto, tomadas de la última sincronización con Odoo.',
  ),
  'stock.z11': dato(
    'Zona 11',
    'Existencias en Zona 11, en la unidad de stock del producto, tomadas de la última sincronización con Odoo.',
  ),
  'stock.pet': dato(
    'Petén',
    'Existencias en Petén, en la unidad de stock del producto, tomadas de la última sincronización con Odoo.',
  ),
  'stock.zac': dato(
    'Zacapa',
    'Existencias en Zacapa, en la unidad de stock del producto, tomadas de la última sincronización con Odoo.',
  ),
  'stock.pat': dato(
    'Patios',
    'Existencias en patios, en la unidad de stock del producto, tomadas de la última sincronización con Odoo. En el MRP semanal los patios se suman a San José.',
  ),

  pxs: calculo('PxS (≤8 días)', 'Suma de lo pendiente de surtir con 8 días o menos.', [
    {
      nombre: 'Entra',
      cuenta: 'Cada línea de pedido de venta cuya edad es de 8 días o menos. La cantidad de la línea es lo ordenado menos lo entregado.',
    },
    {
      nombre: 'No entra',
      cuenta: 'Una línea de más de 8 días, y una línea sin fecha. Esas cajas existen en el total sin corte de edad, y no se restan aquí.',
    },
  ]),

  'modelo.invDisp': calculo(
    'Inv. Disp.',
    'San José + Zona 11 + Petén + Zacapa + Patios − PxS (≤8 días).',
    [
      { nombre: 'San José', cuenta: 'Existencias de esa bodega.' },
      { nombre: 'Zona 11', cuenta: 'Existencias de esa bodega.' },
      { nombre: 'Petén', cuenta: 'Existencias de esa bodega.' },
      { nombre: 'Zacapa', cuenta: 'Existencias de esa bodega.' },
      { nombre: 'Patios', cuenta: 'Existencias de patios.' },
      { nombre: 'PxS (≤8 días)', cuenta: 'Se resta. Es el pendiente de surtir que todavía cuenta.' },
    ],
  ),

  transito: calculo(
    'Tránsito',
    'Tránsito de Odoo hacia bodega + lo que el PDF ya facturó y Odoo todavía no tiene.',
    [
      {
        nombre: 'Odoo',
        cuenta: 'Cajas facturadas y no recibidas que no son entrega directa.',
      },
      {
        nombre: 'PDF',
        cuenta: 'Del mes de la orden global: facturado en PDF, menos lo ya recibido de esa orden, menos el tránsito de Odoo de esa orden. Si la resta es negativa, suma cero. El PDF de una entrega directa no entra.',
      },
    ],
  ),

  entregaDirecta: calculo('Ent. Directa', 'Suma de las cajas en tránsito marcadas como entrega directa.', [
    {
      nombre: 'Qué es',
      cuenta: 'El producto que va a la bodega del cliente y se registra como orden hija de Zona 11.',
    },
    {
      nombre: 'Dónde no entra',
      cuenta: 'No se suma a Tránsito y no descuenta la orden global. Tiene sus propias órdenes.',
    },
  ]),

  proyeccion: calculo(
    'Proyección',
    'Promedio de los últimos 2 meses completos de venta entregada. Un número guardado a mano reemplaza ese promedio.',
    [
      {
        nombre: 'Meses',
        cuenta: 'Los dos meses calendario anteriores al mes en curso. El mes en curso no entra. Un mes sin ventas cuenta como cero.',
      },
      {
        nombre: 'Cada mes',
        cuenta: 'Cajas entregadas. Desde octubre de 2024 salen de Odoo. Enero a septiembre de 2024 salen del historial SAE.',
      },
      {
        nombre: 'Promedio',
        cuenta: 'La suma de esos dos meses, dividida entre 2, redondeada al entero.',
      },
      {
        nombre: 'Corrección',
        cuenta: 'La marca AJ es un número guardado, con autor y fecha. Mientras el campo está en amarillo y todavía no se guarda, Stock de seguridad y Pedido óptimo usan ese número. Al descartar, vuelven al promedio.',
      },
    ],
  ),

  'modelo.stockSeg': calculo('Stock Seg.', 'Redondeo de Proyección ÷ 4.2857.', [
    { nombre: 'Proyección', cuenta: 'La efectiva: la corrección si la hay, y si no, el promedio.' },
    { nombre: 'Divisor', cuenta: SEMANAS + ' El resultado es una semana de esa proyección.' },
  ]),

  'modelo.pedidoOptimo': calculo(
    'Pedido Óptimo',
    'max(0, redondeo(Proyección + Stock de seguridad − Inventario disponible − Tránsito)).',
    [
      { nombre: 'Proyección', cuenta: 'La efectiva de esta fila.' },
      { nombre: 'Stock de seguridad', cuenta: 'Una semana de esa proyección. Se suma.' },
      { nombre: 'Inventario disponible', cuenta: 'Se resta. Es el de las cuatro bodegas más patios, ya neto de PxS.' },
      { nombre: 'Tránsito', cuenta: 'Se resta. La entrega directa no se resta.' },
      { nombre: 'Piso', cuenta: 'Si la cuenta da negativo, el pedido es cero.' },
    ],
  ),

  'modelo.vol': calculo('Vol. m³', 'Redondeo a 4 decimales de cubicaje × Pedido óptimo. La celda muestra 2 decimales.', [
    { nombre: 'Cubicaje', cuenta: 'Metros cúbicos por caja, del producto.' },
    { nombre: 'Pedido óptimo', cuenta: 'Las cajas de esta fila.' },
  ]),

  'mrp.puesto': dato(
    '#',
    'El puesto después de ordenar por nivel, de menor a mayor. El 1 es el de menos semanas de cobertura. Un producto sin venta semanal queda al final: su nivel se guarda como 999 para poder ordenarlo.',
  ),
  'mrp.invDispBodega': calculo('Inv Disp Bodega', 'San José + Patios − PxS (≤8 días).', [
    { nombre: 'San José', cuenta: 'Existencias de la bodega que despacha.' },
    { nombre: 'Patios', cuenta: 'Se suman a San José.' },
    { nombre: 'PxS (≤8 días)', cuenta: 'Se resta.' },
    { nombre: 'No entran', cuenta: 'Zona 11, Petén y Zacapa. Esas bodegas tienen su propia tabla.' },
  ]),
  'mrp.promMensual': calculo(
    'Prom Mensual',
    'La proyección del Modelo: promedio de los últimos 2 meses completos, o la corrección si la hay.',
    [
      {
        nombre: 'Sin corrección',
        cuenta: 'Promedio de los dos meses calendario anteriores al mes en curso, redondeado al entero. El mes en curso no entra.',
      },
      {
        nombre: 'Con corrección',
        cuenta: 'Si en el Modelo hay un número guardado (marca AJ) o una edición amarilla todavía sin guardar, esta columna usa ese número.',
      },
    ],
  ),
  'mrp.invNeto': calculo('Inv Neto', 'Inv. Disp. Bodega + Tránsito.', [
    { nombre: 'Inv. Disp. Bodega', cuenta: 'San José + Patios − PxS.' },
    { nombre: 'Tránsito', cuenta: 'El mismo tránsito de la columna de al lado, sin la entrega directa.' },
  ]),
  'mrp.ventaSem': calculo('Venta Sem.', 'Redondeo de Promedio mensual ÷ 4.2857.', [
    { nombre: 'Promedio mensual', cuenta: 'La proyección del Modelo, corrección incluida.' },
    { nombre: 'Divisor', cuenta: SEMANAS },
  ]),
  'mrp.pedido': calculo(
    'Ped. Opt. Sem.',
    'max(0, redondeo(2 × Venta semanal − Inventario neto)).',
    [
      { nombre: '2 × Venta semanal', cuenta: 'Dos semanas de la venta semanal. Es el objetivo del MRP.' },
      { nombre: 'Inventario neto', cuenta: 'Se resta.' },
      { nombre: 'Piso', cuenta: 'Si la cuenta da negativo, el pedido es cero.' },
    ],
  ),
  'mrp.nivel': calculo(
    'Nivel (sem)',
    'Inventario neto ÷ Venta semanal, redondeado a 2 decimales.',
    [
      { nombre: 'Inventario neto', cuenta: 'Inv. Disp. Bodega + Tránsito.' },
      { nombre: 'Venta semanal', cuenta: 'El divisor.' },
      {
        nombre: 'Sin venta',
        cuenta: 'Si la venta semanal es cero, no hay nivel. La celda muestra una raya. Para ordenar, el motor guarda 999 y esa fila queda al final.',
      },
    ],
  ),
  'mrp.prioridad': calculo('Prioridad', 'La banda del nivel, en semanas.', [
    { nombre: 'Crítico', cuenta: 'Menos de 2 semanas.' },
    { nombre: 'Precaución', cuenta: 'De 2 semanas hasta menos de 4.' },
    { nombre: 'OK', cuenta: '4 semanas o más. Un producto sin venta semanal cae aquí, porque su nivel interno es 999.' },
  ]),
  'mrp.cajas': calculo(
    'Cajas a Desp.',
    'El pedido óptimo semanal. El código de furgón completo se baja al múltiplo de un furgón.',
    [
      { nombre: 'Producto normal', cuenta: 'Las cajas a despachar son el pedido óptimo semanal.' },
      {
        nombre: 'Furgón completo',
        cuenta: 'Cuando el modelo tiene capacidad, el código dedicado (en Reyma, VT10) despacha furgones enteros. Cajas por furgón = parte entera de capacidad ÷ cubicaje. Lo que no completa otro furgón no se despacha, y el plan lo avisa.',
      },
      {
        nombre: 'Sin capacidad',
        cuenta: 'Si el modelo no tiene metros cúbicos de furgón, nadie recibe ese corte. Todas las filas usan el pedido óptimo semanal.',
      },
    ],
  ),
  'mrp.vol': calculo('Vol. m³', 'Cajas a despachar × cubicaje. La celda muestra 2 decimales.', [
    { nombre: 'Cajas a despachar', cuenta: 'Las de esta fila, ya con el corte del furgón completo si aplica.' },
    { nombre: 'Cubicaje', cuenta: 'Metros cúbicos por caja.' },
  ]),

  'regional.inv': dato(
    'Inv. bodega',
    'Existencias de la bodega elegida arriba: Zacapa, Petén o Zona 11. Los patios no se suman. San José no usa esta tabla; su MRP es el semanal.',
  ),
  'regional.pxs': dato(
    'PxS (≤8 días)',
    'El pendiente de surtir de 8 días o menos cuya bodega de origen es la bodega elegida. La regla de edad es la misma que en el Modelo.',
  ),
  'regional.transito': dato(
    'Tránsito',
    'El tránsito cuyo destino es la bodega elegida.',
  ),
  'regional.neto': calculo('Neto', 'Inventario de la bodega − PxS de la bodega + Tránsito de la bodega.', [
    { nombre: 'Inventario', cuenta: 'La columna Inv. bodega.' },
    { nombre: 'PxS', cuenta: 'Se resta. Es el de esta bodega.' },
    { nombre: 'Tránsito', cuenta: 'Se suma. Es el que viene hacia esta bodega.' },
  ]),
  'regional.prom': calculo(
    'Prom. mensual',
    'Promedio de los últimos 2 meses completos de venta entregada de esta bodega.',
    [
      {
        nombre: 'Meses',
        cuenta: 'Los dos meses calendario anteriores al mes en curso. El mes en curso no entra. Un mes sin ventas de esta bodega cuenta como cero.',
      },
      {
        nombre: 'Qué venta',
        cuenta: 'Sólo la de la bodega elegida. No es la proyección global del Modelo, y una corrección guardada en el Modelo no la cambia.',
      },
      { nombre: 'Promedio', cuenta: 'La suma de esos dos meses, dividida entre 2, redondeada al entero.' },
    ],
  ),
  'regional.ventaSem': calculo('Venta sem.', 'Redondeo de Promedio mensual ÷ 4.2857.', [
    { nombre: 'Promedio mensual', cuenta: 'El de esta bodega.' },
    { nombre: 'Divisor', cuenta: SEMANAS },
  ]),
  'regional.pedido': calculo(
    'Pedido',
    'max(0, redondeo(semanas objetivo × Venta semanal − Neto)).',
    [
      {
        nombre: 'Semanas objetivo',
        cuenta: 'El número de «Nivelar a», al lado del selector de bodega. Arranca en 3.',
      },
      { nombre: 'Venta semanal', cuenta: 'La de esta bodega. Se multiplica por las semanas objetivo.' },
      { nombre: 'Neto', cuenta: 'Se resta.' },
      { nombre: 'Piso', cuenta: 'Si la cuenta da negativo, el pedido es cero. Una fila sin pedido, sin neto y sin promedio no se muestra.' },
    ],
  ),
  'regional.nivel': calculo(
    'Nivel (sem)',
    'Neto ÷ Venta semanal, redondeado a 2 decimales.',
    [
      { nombre: 'Neto', cuenta: 'Inventario − PxS + Tránsito, de esta bodega.' },
      { nombre: 'Venta semanal', cuenta: 'El divisor.' },
      {
        nombre: 'Sin venta',
        cuenta: 'Si la venta semanal es cero, la celda muestra una raya. Para ordenar, el motor guarda 999.',
      },
    ],
  ),
  'regional.m3': calculo('m³', 'Pedido × cubicaje. La celda muestra 2 decimales.', [
    { nombre: 'Pedido', cuenta: 'Las cajas de esta fila, después de nivelar.' },
    { nombre: 'Cubicaje', cuenta: 'Metros cúbicos por caja.' },
  ]),

  'cumpl.catPedido': calculo('Pedido', 'Suma del pedido de los productos de esa categoría.', [
    { nombre: 'Cada producto', cuenta: 'Las cajas de su línea en la orden global de Odoo.' },
  ]),
  'cumpl.catFacturado': calculo('Facturado', 'Suma del facturado de los productos de esa categoría.', [
    { nombre: 'Cada producto', cuenta: 'La misma cuenta de la tabla de abajo: Odoo más el PDF que Odoo todavía no tiene.' },
  ]),
  'cumpl.fill': calculo('Fill', 'Facturado ÷ Pedido.', [
    { nombre: 'Pedido', cuenta: 'El denominador. Si es cero, el fill es cero.' },
    { nombre: 'Facturado', cuenta: 'El numerador. Puede pasar del pedido: el porcentaje entonces pasa de 100.' },
    { nombre: 'La barra', cuenta: 'Se detiene en 100%. El porcentaje escrito al lado es la división real.' },
  ]),
  'cumpl.pedido': dato(
    'Pedido',
    'Las cajas de la línea en la orden global de Odoo, la PO del mes.',
  ),
  'cumpl.facturado': calculo(
    'Facturado',
    'Facturas de proveedor en Odoo del mes + facturas PDF del mes que Odoo todavía no tiene. Las notas de crédito restan.',
    [
      {
        nombre: 'Odoo',
        cuenta: 'Las facturas del mes suman. Una nota de crédito resta. Una factura de entrega directa no entra: descuenta su orden hija, no la orden global.',
      },
      {
        nombre: 'PDF',
        cuenta: 'Suma cuando esa factura todavía no está enlazada a una bill de Odoo del mismo mes. Si ya está enlazada, cuenta la de Odoo y el PDF no se vuelve a sumar. La marca PDF dice cuántas cajas vienen sólo del PDF.',
      },
    ],
  ),
  'cumpl.recibidas': dato(
    'Recibidas',
    'Las cajas ya recibidas de esa línea en la orden global de Odoo.',
  ),
  'cumpl.saldo': calculo('Saldo', 'Pedido − Facturado.', [
    { nombre: 'Pedido', cuenta: 'Las cajas de la orden global.' },
    { nombre: 'Facturado', cuenta: 'Se resta. Un saldo negativo es mercancía facturada por encima de la orden.' },
  ]),

  'eta.factura': dato('Factura', 'El número de la factura del proveedor, leído del PDF.'),
  'eta.guia': dato('Guía', 'La guía que trae el PDF. Si el documento no la trae, la celda queda en blanco.'),
  'eta.destino': dato(
    'Destino',
    'La bodega declarada al cargar la factura: San José, Zacapa, Petén, o entrega directa.',
  ),
  'eta.fecha': dato('Fecha factura', 'La fecha impresa en el PDF. No es el día en que se cargó el archivo.'),
  'eta.eta': calculo(
    'ETA',
    'La fecha escrita a mano, si existe. Si no, la fecha impresa más los días hábiles del destino.',
    [
      {
        nombre: 'A mano',
        cuenta: 'Gana. Si difiere de la calculada, las dos se ven: la que manda, y al lado la calculada.',
      },
      {
        nombre: 'Calculada',
        cuenta: 'Fecha impresa más N días hábiles. La fecha de la factura no cuenta como día 1. Sábado y domingo no cuentan. Los feriados todavía no. N sale de la configuración de esa bodega; si no hay fila, son 4.',
      },
    ],
  ),
  'eta.cajas': calculo('Cajas', 'Suma de las cantidades de las líneas de esa factura.', [
    { nombre: 'Líneas', cuenta: 'Cada renglón del PDF, ya convertido a la unidad de compra.' },
  ]),

  'conc.facturaPdf': dato('Factura PDF', 'El número de la factura del proveedor que se está enlazando con una bill de Odoo.'),
  'conc.bill': dato('Bill de Odoo', 'La vendor bill con la que esa factura PDF quedó enlazada.'),
  'conc.tier': dato(
    'Tier',
    'El peldaño de la regla que hizo el enlace. 1: el folio del CFDI está en la referencia de la bill. 2: coinciden el monto, las líneas y la fecha, los tres. No hay un peldaño por parecido.',
  ),
  'conc.regla': dato('Regla', 'La igualdad que se cumplió, escrita con las palabras de ese peldaño.'),
  'conc.estado': dato(
    'Estado',
    '«auto» lo cerró la regla sola. «confirmado» lo cerró una persona con «Es la misma». «rechazado» es un par que una persona separó.',
  ),
  'conc.quien': dato(
    'Quién / cuándo',
    'Quién dejó el enlace por escrito, y el día. «Sin registrar» significa que el número ya se está usando y todavía nadie apretó «Ejecutar conciliación» para guardar el rastro.',
  ),
  'conc.candidata': dato(
    'Bill candidata',
    'Una vendor bill que comparte algo exacto con la factura PDF y todavía no tiene enlace. La persona decide si es la misma.',
  ),
  'conc.porque': dato('Por qué', 'Qué igualdad exacta puso a esta bill en la cola. No es un puntaje de parecido.'),
  'conc.totalPdf': dato('Total PDF', 'El total de la factura PDF, el que se comparó con la bill.'),
  'conc.totalOdoo': dato('Total Odoo', 'El total de la bill candidata, el que se comparó con el PDF.'),
  'conc.fechaPdf': dato('Fecha PDF', 'La fecha impresa de la factura PDF.'),
  'conc.fechaOdoo': dato('Fecha Odoo', 'La fecha de la bill candidata. Si Odoo no la trae, la celda queda en blanco.'),

  'pedido.cajas': calculo(
    'Cajas',
    'Al generar, el pedido óptimo del Modelo. Después, el número que se escribió en la celda.',
    [
      { nombre: 'Al generar', cuenta: 'Entran los productos cuyo pedido óptimo es mayor que cero. Las cajas iniciales son ese pedido.' },
      { nombre: 'Después', cuenta: 'La celda amarilla reemplaza ese número en esta orden. No vuelve a calcular el Modelo.' },
    ],
  ),
  'pedido.precio': dato(
    'Precio USD',
    'El precio vigente en el momento de generar la orden, copiado de la pestaña Modelo. Cambiar el precio allá después no mueve esta línea: hay que volver a generar.',
  ),
  'pedido.total': calculo('Total USD', 'Cajas × Precio USD.', [
    { nombre: 'Cajas', cuenta: 'Las de esta línea, ya editadas si se editaron.' },
    { nombre: 'Precio', cuenta: 'El precio copiado al generar.' },
  ]),
  'pedido.m3': calculo('m³', 'Cajas × cubicaje. La celda muestra 2 decimales.', [
    { nombre: 'Cajas', cuenta: 'Las de esta línea.' },
    { nombre: 'Cubicaje', cuenta: 'Metros cúbicos por caja del producto.' },
  ]),

  'nc.cajas': calculo(
    'Cajas facturadas',
    'Suma de las facturas de proveedor del mes, sólo en los códigos de la nota de crédito. Una nota de crédito resta.',
    [
      { nombre: 'Mes', cuenta: 'El mes elegido arriba.' },
      { nombre: 'Códigos', cuenta: 'La lista de vasos de duroport de la nota. Un producto fuera de esa lista no aparece.' },
      { nombre: 'Signo', cuenta: 'Una factura suma. Una nota de crédito resta.' },
    ],
  ),
  'nc.usd': calculo('NC USD', 'Redondeo a 2 decimales de Cajas facturadas × tarifa.', [
    { nombre: 'Cajas', cuenta: 'Las de esta fila, en el mes elegido.' },
    { nombre: 'Tarifa', cuenta: 'Dólares por caja. Es el número editable de arriba, no un precio del producto.' },
  ]),
  'nc.facturas': dato(
    'Facturas',
    'Cuántas facturas distintas de Odoo aportan cajas a esta fila en el mes elegido.',
  ),

  'precio.factura': dato('Factura', 'El número de la vendor bill de Odoo donde se leyó el precio.'),
  'precio.fecha': dato('Fecha', 'La fecha de esa bill.'),
  'precio.unitario': dato('Precio factura', 'El precio unitario impreso en esa línea de la bill.'),
  'precio.vigente': dato(
    'Precio vigente',
    'El precio de compra que el Modelo tiene hoy para ese código. Si el producto no tiene precio vigente, la línea no entra en esta tabla.',
  ),
  'precio.delta': calculo('Δ', '(Precio factura − Precio vigente) ÷ Precio vigente.', [
    { nombre: 'Precio factura', cuenta: 'El de la bill.' },
    { nombre: 'Precio vigente', cuenta: 'El del Modelo. Es el denominador.' },
    {
      nombre: 'Qué se lista',
      cuenta: 'Sólo facturas, no notas de crédito, y sólo cuando el valor absoluto pasa de 1%. La tabla muestra las 40 diferencias más grandes.',
    },
  ]),

  'ventas.anio': dato(
    'Año',
    'Agrupa los meses de debajo. 2024 y 2025 traen los doce meses. El año en curso trae desde enero hasta el mes actual, y ese mes está incompleto.',
  ),
  'ventas.mes': dato(
    'Mes',
    'Cajas entregadas en ese mes. De octubre de 2024 en adelante salen de Odoo. De enero a septiembre de 2024 salen del historial SAE. Una celda en blanco es cero. El mes en curso está incompleto. El mismo nombre de mes se repite una vez por año: cada clic explica la columna, no un año en particular.',
  ),
  'ventas.factor': calculo(
    'Factor',
    '(Suma de enero a mayo del año en curso) ÷ (suma de enero a mayo del año anterior).',
    [
      { nombre: 'Numerador', cuenta: 'Enero, febrero, marzo, abril y mayo del año en curso. Si el año todavía no llega a mayo, entran sólo los meses que ya están en la tabla.' },
      { nombre: 'Denominador', cuenta: 'Los mismos meses del año anterior.' },
      { nombre: 'Si el año anterior suma cero', cuenta: 'El factor es 1. No se divide entre cero.' },
    ],
  ),
  'ventas.pronAct': calculo(
    'Pron. mes act.',
    'El pronóstico de julio del libro: redondeo a 1 decimal de julio del año anterior × Factor.',
    [
      {
        nombre: 'Julio del año anterior',
        cuenta: 'Si ese julio tiene ventas, se multiplica por el Factor.',
      },
      {
        nombre: 'Si ese julio es cero',
        cuenta: 'Se usa julio de dos años atrás, sin multiplicar por el Factor. Si ese también es cero, el pronóstico es cero.',
      },
      {
        nombre: 'El nombre de la columna',
        cuenta: 'Dice «mes actual». La cuenta que corre es la de julio, la que quedó medida en el libro. No se mueve con el calendario.',
      },
    ],
  ),
  'ventas.pronSig': calculo(
    'Pron. mes sig.',
    'El pronóstico de agosto del libro: redondeo a 1 decimal de agosto del año anterior × Factor.',
    [
      {
        nombre: 'Agosto del año anterior',
        cuenta: 'Si ese agosto tiene ventas, se multiplica por el Factor.',
      },
      {
        nombre: 'Si ese agosto es cero',
        cuenta: 'Se usa agosto de dos años atrás, sin multiplicar por el Factor. Si ese también es cero, el pronóstico es cero.',
      },
      {
        nombre: 'El nombre de la columna',
        cuenta: 'Dice «mes siguiente». La cuenta que corre es la de agosto, la que quedó medida en el libro. No se mueve con el calendario.',
      },
    ],
  ),

  'datos.po': dato(
    'PO',
    'La orden de compra de la línea en tránsito. Una fila que termina en «facturas PDF» no es una orden: son cajas facturadas en el PDF y todavía no registradas en Odoo.',
  ),
  'datos.cajas': dato(
    'Cajas',
    'En una línea de Odoo, lo facturado que todavía no se recibe. En una fila de facturas PDF, el extra que el PDF tiene por encima de lo recibido y del tránsito de Odoo de esa orden.',
  ),
  'datos.destino': dato('Destino', 'La bodega a la que va esa línea, o el destino declarado en el PDF.'),
  'datos.etaAlexis': dato(
    'ETA Alexis',
    'La fecha escrita a mano para esa orden. Una celda vacía es una fecha que nadie confirmó. No se rellena con la calculada.',
  ),
  'datos.etaApp': calculo(
    'ETA App',
    'Fecha impresa de la factura más los días hábiles de esa bodega.',
    [
      {
        nombre: 'Cuándo hay fecha',
        cuenta: 'Sólo en las filas que salen de un PDF. Sábado y domingo no cuentan. La fecha de la factura no cuenta como día 1. Los feriados todavía no.',
      },
      {
        nombre: 'Cuándo queda vacía',
        cuenta: 'Una línea de tránsito de Odoo no trae fecha impresa. No se inventa una ETA.',
      },
    ],
  ),
  'datos.nota': dato(
    'Nota',
    'El texto guardado junto a la orden. En una fila de facturas PDF, la nota dice que esas cajas todavía no están en Odoo.',
  ),
  'datos.tipo': dato(
    'Tipo',
    '«Entrega directa» si la línea de tránsito está marcada así. «A bodega» en cualquier otro caso, incluidas las filas que vienen sólo del PDF.',
  ),
} as const satisfies Record<string, ExplicacionColumna>;

export type ColumnaId = keyof typeof EXPLICACIONES;

export function explicacionColumna(id: ColumnaId): ExplicacionColumna {
  return EXPLICACIONES[id];
}
