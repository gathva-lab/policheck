import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodificarEntidadesHtml,
  fetchSenadoresVigentes,
  nombreCompleto,
  normalizarNombre,
  parsearSenadoresXml,
} from './senado';

const XML_MUESTRA = `<?xml version="1.0" encoding="ISO-8859-1"?>
<senadores>
  <senador>
    <PARLID>101</PARLID>
    <PARLAPELLIDOPATERNO>P&eacute;rez</PARLAPELLIDOPATERNO>
    <PARLAPELLIDOMATERNO>Mu&ntilde;oz</PARLAPELLIDOMATERNO>
    <PARLNOMBRE>Jos&eacute;</PARLNOMBRE>
    <REGION>Valpara&iacute;so</REGION>
    <CIRCUNSCRIPCION>Circunscripci&oacute;n 6</CIRCUNSCRIPCION>
    <PARTIDO>Partido &amp; Algo</PARTIDO>
    <EMAIL>jose.perez@senado.cl</EMAIL>
    <CURRICULUM>https://www.senado.cl/perez?a=1&amp;b=2</CURRICULUM>
  </senador>
  <senador>
    <PARLID>202</PARLID>
    <PARLAPELLIDOPATERNO>Gonz&aacute;lez</PARLAPELLIDOPATERNO>
    <PARLAPELLIDOMATERNO>Rojas</PARLAPELLIDOMATERNO>
    <PARLNOMBRE>Mar&iacute;a</PARLNOMBRE>
    <REGION>Metropolitana</REGION>
    <CIRCUNSCRIPCION>Circunscripci&oacute;n 7</CIRCUNSCRIPCION>
    <PARTIDO>Independiente</PARTIDO>
    <EMAIL></EMAIL>
    <CURRICULUM></CURRICULUM>
  </senador>
</senadores>`;

const PAGINA_MANTENIMIENTO = `<!DOCTYPE html>
<html><head><title>Mantenimiento</title></head>
<body><h1>Servicio en mantenimiento</h1><p>Vuelva más tarde.</p></body></html>`;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parsearSenadoresXml', () => {
  it('extrae todos los campos de dos senadores y decodifica entidades', () => {
    const senadores = parsearSenadoresXml(XML_MUESTRA);

    expect(senadores).toHaveLength(2);
    expect(senadores[0]).toEqual({
      parlId: '101',
      nombre: 'José',
      apellidoPaterno: 'Pérez',
      apellidoMaterno: 'Muñoz',
      region: 'Valparaíso',
      circunscripcion: 'Circunscripción 6',
      partido: 'Partido & Algo',
      email: 'jose.perez@senado.cl',
      curriculum: 'https://www.senado.cl/perez?a=1&b=2',
    });
    expect(senadores[1].parlId).toBe('202');
    expect(senadores[1].nombre).toBe('María');
    expect(senadores[1].apellidoPaterno).toBe('González');
    expect(senadores[1].email).toBeNull();
    expect(senadores[1].curriculum).toBeNull();
  });

  it('lanza un error accionable cuando el cuerpo es la página de mantenimiento', () => {
    expect(() => parsearSenadoresXml(PAGINA_MANTENIMIENTO)).toThrow(/mantenimiento/i);
    expect(() => parsearSenadoresXml(PAGINA_MANTENIMIENTO)).toThrow(/senadores/i);
  });
});

describe('decodificarEntidadesHtml', () => {
  it('decodifica entidades con y sin tilde, ampersand y numéricas', () => {
    expect(decodificarEntidadesHtml('&aacute;&uacute;&ntilde;&amp;')).toBe('áúñ&');
    expect(decodificarEntidadesHtml('&Aacute;&Ntilde;')).toBe('ÁÑ');
    expect(decodificarEntidadesHtml('&#225;&#241;&#x26;')).toBe('áñ&');
  });

  it('no decodifica dos veces una entidad escapada', () => {
    expect(decodificarEntidadesHtml('&amp;aacute;')).toBe('&aacute;');
  });
});

describe('fetchSenadoresVigentes', () => {
  it('descarga y parsea el XML del Senado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(XML_MUESTRA, {
        status: 200,
        headers: { 'Content-Type': 'text/xml; charset=ISO-8859-1' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const senadores = await fetchSenadoresVigentes();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('senadores_vigentes.php');
    expect(senadores).toHaveLength(2);
    expect(senadores[0].parlId).toBe('101');
  });

  it('propaga el error accionable si el servicio responde la página de mantenimiento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(PAGINA_MANTENIMIENTO, { status: 200 }))
    );

    await expect(fetchSenadoresVigentes()).rejects.toThrow(/mantenimiento/i);
  });
});

describe('normalización de nombres', () => {
  it('arma el nombre completo y normaliza tildes, mayúsculas y espacios', () => {
    const [primero] = parsearSenadoresXml(XML_MUESTRA);

    expect(nombreCompleto(primero)).toBe('José Pérez Muñoz');
    expect(normalizarNombre(nombreCompleto(primero))).toBe('jose perez munoz');
    expect(normalizarNombre('  MARÍA   González-Rojas  ')).toBe('maria gonzalez rojas');
  });
});
