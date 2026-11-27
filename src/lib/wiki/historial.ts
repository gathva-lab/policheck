export interface CambioMetodologia {
  fecha: string;
  titulo: string;
  queCambio: string;
  porQue: string;
  evidencia: string;
  tipo: 'mejora' | 'correccion' | 'hallazgo';
}

export const HISTORIAL_METODOLOGIA: CambioMetodologia[] = [
  {
    fecha: '2026-11-27',
    titulo: 'El veredicto usa la mediana y la naturaleza del contenido manda',
    queCambio: 'El puntaje de veracidad pasa de promedio a mediana de los modelos',
    porQue: 'Con un solo modelo discrepante, el promedio se alejaba de lo que decía la mayoría',
    evidencia: 'Fuente JgvC9xaUKN8: puntajes 2, 3 y 65 ⇒ promedio 23,33 · mediana 3',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-27',
    titulo: 'El veredicto usa la mediana y la naturaleza del contenido manda',
    queCambio:
      'Si más de la mitad de los modelos clasifica el contenido como opinión, el veredicto se fija en no evaluable',
    porQue:
      'Una entrevista de opinión no se puede puntuar por veracidad: no hay hechos falsables',
    evidencia: '3 de 3 modelos coincidieron en opinion',
    tipo: 'correccion',
  },
  {
    fecha: '2026-11-27',
    titulo: 'El veredicto usa la mediana y la naturaleza del contenido manda',
    queCambio: 'Un reporte que se contradice a sí mismo se descarta del consenso',
    porQue: 'mixto con puntaje 3 (franja de "no evaluable") es incoherente',
    evidencia: 'Caso real: tencent/hy4-flash con naturaleza mixto y veracidad 3',
    tipo: 'correccion',
  },
  {
    fecha: '2026-11-27',
    titulo: 'Dos proveedores de modelos y enrutamiento por modelo',
    queCambio:
      'nemotron-3-ultra se sirve desde NVIDIA Build en lugar de la cola gratuita de OpenRouter, con reintento automático por OpenRouter',
    porQue: 'Fallaba 1 de cada 2 veces con 26,7 s de latencia media',
    evidencia: '9 llamadas: 5 éxitos, 4 timeouts; tras el cambio, 457 ms',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-27',
    titulo: 'Dos proveedores de modelos y enrutamiento por modelo',
    queCambio: 'Se añaden minimax-m3.1-flash y glm-5.3-flash como modelos gratuitos de reserva',
    porQue: 'Disponibles sin coste en NVIDIA Build',
    evidencia: 'Verificación del catálogo del proveedor',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-27',
    titulo: 'La transcripción se guarda y se reutiliza',
    queCambio:
      'La transcripción extraída se persiste en la base de datos y se reutiliza en los re-análisis',
    porQue:
      'Cada re-análisis volvía a pedir la misma transcripción a YouTube y fallaba por límite de peticiones desde las IP del servidor',
    evidencia:
      'El mismo video funcionó al reintentar minutos después, con subtítulos disponibles en todo momento',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-27',
    titulo: 'La transcripción se guarda y se reutiliza',
    queCambio: 'Reintentos con espera (500 ms, 1500 ms) ante bloqueo',
    porQue: 'Un límite temporal no debe convertirse en un fallo definitivo',
    evidencia: '—',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-27',
    titulo: 'La transcripción se guarda y se reutiliza',
    queCambio:
      'Se distingue "la plataforma está limitando" de "el video no tiene subtítulos"',
    porQue: 'Los dos casos daban el mismo mensaje y requieren acciones distintas',
    evidencia: '—',
    tipo: 'correccion',
  },
  {
    fecha: '2026-11-27',
    titulo: 'Cifras sin puntaje en los resúmenes',
    queCambio: 'Los resúmenes en lenguaje ciudadano no citan números de puntaje',
    porQue:
      'Un modelo escribía en su resumen sus propios puntajes (68 y 78) mientras la interfaz mostraba el consenso de todos (67 y 74), y el lector lo interpretaba como una contradicción del sistema',
    evidencia: 'Fuente d-E-27lHfGw',
    tipo: 'correccion',
  },
  {
    fecha: '2026-11-27',
    titulo: 'Cifras sin puntaje en los resúmenes',
    queCambio: 'La interfaz indica qué modelo redactó el resumen',
    porQue: 'Para que el lector sepa que el resumen es de un modelo y los puntajes del consenso',
    evidencia: '—',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-25',
    titulo: 'Separación de las dos señales de confianza',
    queCambio:
      'El acuerdo entre modelos y el respaldo de JEV se muestran como dos señales separadas',
    porQue: 'Se combinaban tomando el mínimo, lo que ocultaba cuál de las dos estaba fallando',
    evidencia: '—',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-25',
    titulo: 'Separación de las dos señales de confianza',
    queCambio:
      'JEV veta por probabilidades, no por confianza: no_soportado ≥ 0,5 veta; soportado ≥ 0,5 no veta aunque la confianza sea baja',
    porQue: 'Usar la confianza hacía que JEV vetara veredictos correctos',
    evidencia: '—',
    tipo: 'correccion',
  },
  {
    fecha: '2026-11-25',
    titulo: 'Lenguaje ciudadano y honestidad sobre opinión',
    queCambio:
      'Se prohíbe la jerga técnica en los resúmenes (términos como FEVER, NEI, SUPPORTED, REFUTED)',
    porQue: 'El público objetivo no es académico',
    evidencia: '—',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-25',
    titulo: 'Lenguaje ciudadano y honestidad sobre opinión',
    queCambio:
      'Si el contenido es opinión, el puntaje baja a la franja de "no evaluable" o "discutible"',
    porQue: 'Puntuar alto una opinión da una falsa impresión de rigor',
    evidencia: '—',
    tipo: 'correccion',
  },
  {
    fecha: '2026-11-25',
    titulo: 'Lenguaje ciudadano y honestidad sobre opinión',
    queCambio: 'Se muestran citas textuales con su valoración',
    porQue: 'El lector debe poder comprobar por sí mismo',
    evidencia: '—',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-25',
    titulo: 'Deploy automático y normalización de URLs',
    queCambio: 'Cada push a dev se despliega automáticamente',
    porQue: 'Cinco mejoras mergeadas nunca llegaron a producción: el despliegue era manual e invisible',
    evidencia: 'La interfaz en producción seguía siendo la del 24 de noviembre',
    tipo: 'hallazgo',
  },
  {
    fecha: '2026-11-25',
    titulo: 'Deploy automático y normalización de URLs',
    queCambio: 'Las URLs de YouTube se normalizan antes de guardarse',
    porQue:
      'El mismo video entró dos veces por parámetros distintos (?si=...) y se analizó dos veces',
    evidencia: 'Mismo video: una copia verificada con 78 y otra sin verificar',
    tipo: 'hallazgo',
  },
  {
    fecha: '2026-11-25',
    titulo: 'Consenso parcial aceptado y modelos de frontera desactivados',
    queCambio: 'Se acepta el consenso con 2 de 3 modelos',
    porQue: 'Con un solo modelo se perdía el veredicto aunque fuera correcto',
    evidencia:
      'Análisis real: 1 de 3 respondió y el veredicto quedó en null a pesar de tener verdadero_pero con 80',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-25',
    titulo: 'Consenso parcial aceptado y modelos de frontera desactivados',
    queCambio: 'Los modelos elegibles se ordenan por prioridad explícita, no por orden de tabla',
    porQue: 'El sistema eligió por accidente un modelo más caro y menos fiable',
    evidencia: '—',
    tipo: 'correccion',
  },
  {
    fecha: '2026-11-25',
    titulo: 'Consenso parcial aceptado y modelos de frontera desactivados',
    queCambio: 'Los modelos de frontera quedan en el catálogo desactivados',
    porQue: 'Coste desproporcionado; se activan con una bandera cuando haga falta',
    evidencia: '—',
    tipo: 'hallazgo',
  },
  {
    fecha: '2026-11-24',
    titulo: 'JEV como capa de decisión',
    queCambio:
      'JEV actúa como filtro previo (¿es verificable?) y verificación posterior (¿el veredicto se sostiene?)',
    porQue: 'Añade rigor sin generar texto, a coste mínimo',
    evidencia: 'Prueba real: noul 0,97, coste 0,0000182 USD',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-24',
    titulo: 'JEV como capa de decisión',
    queCambio: 'JEV solo puede agravar un veredicto, nunca mejorarlo',
    porQue: 'Evita que un modelo de decisión "blanquee" un resultado',
    evidencia: '—',
    tipo: 'mejora',
  },
  {
    fecha: '2026-11-24',
    titulo: 'JEV como capa de decisión',
    queCambio: 'Si JEV falla, el sistema continúa (fail-open)',
    porQue: 'No debe bloquear el servicio',
    evidencia: '—',
    tipo: 'mejora',
  },
];
