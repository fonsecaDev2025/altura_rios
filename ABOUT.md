# About

Altura Ríos Dashboard es una aplicación web para consultar y visualizar alturas hidrométricas de ríos a partir de fuentes públicas.

El proyecto nace como una herramienta simple para reunir información de la cuenca del Paraná y del Río Paraguay en una interfaz clara, rápida y accesible. Su objetivo es facilitar la lectura de niveles, variaciones y estaciones disponibles sin depender de procesos pesados ni automatizaciones complejas.

## Qué hace

- Consulta datos de alturas hidrométricas desde FICH/UNL.
- Consulta estaciones convencionales del Río Paraguay desde DMH Paraguay.
- Permite cargar manualmente pasos, profundidades y alturas relevadas durante la navegación.
- Expone una API REST para consumir los datos en JSON.
- Muestra la información en un dashboard web responsive.
- Guarda extracciones locales en SQLite y sirve respuestas desde caché.
- Permite ejecutar tareas diarias para actualizar datos.

## Pasos y profundidades

Además de las fuentes automáticas, la aplicación incluye una sección de **Pasos y profundidades** para registrar manualmente información relevada durante la navegación (por ejemplo, profundidades y anchos en distintos pasos del río).

Esta sección funciona con cuentas de usuario:

- Registro e inicio de sesión mediante sesión con cookie `HttpOnly`.
- Cada usuario administra sus propios registros (CRUD: crear, listar, editar y eliminar).
- Cada registro guarda fecha, puerto, altura, paso, profundidad y ancho.
- Los datos se persisten localmente en SQLite y se exponen vía la API `/api/pasos`.

A diferencia de las alturas de FICH/UNL y DMH Paraguay, estos datos no provienen de fuentes públicas, sino de la carga manual de cada usuario.

## Enfoque del proyecto

La aplicación prioriza una arquitectura liviana:

- Backend con Express.
- Parsers HTML sin navegador headless.
- Frontend estático con HTML, CSS y JavaScript.
- Base de datos local con SQLite.

Este enfoque permite desplegar y ejecutar el proyecto con pocos recursos, manteniendo el código fácil de revisar y adaptar.

## Fuentes de datos

Los datos provienen de sitios públicos:

- FICH/UNL para alturas de la cuenca del Paraná.
- DMH Paraguay para estaciones convencionales del Río Paraguay.

Si el HTML de las fuentes cambia, los parsers pueden requerir ajustes.

## Uso previsto

Este repositorio puede servir como:

- Dashboard público o interno de consulta hidrométrica.
- Base para experimentar con parsers de datos públicos.
- Proyecto de referencia para una API simple con persistencia SQLite.
- Punto de partida para agregar nuevas fuentes, filtros o visualizaciones.

## Estado

Proyecto en evolución, orientado a mantener una solución práctica, liviana y fácil de desplegar.
