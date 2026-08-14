# Boli

<p align="center">
  <img src="public/boli-logo.png" alt="Boli" width="380">
</p>

Escondite en **primera persona**, pensado para partidas privadas con amigos.

Un jugador es el **cazador**. El resto son **infiltrados** que se mezclan con una manada de bolis. El cazador tiene que descubrir quién no es NPC. Los infiltrados tienen que pasar desapercibidos: completar una misión secreta o aguantar hasta que se acabe el tiempo.

El estilo visual es cartoon: menú ilustrado, cielo con ciclo día/noche y un pueblo todavía en prototipo.

---

## Estado del proyecto

### Completado

**Menú**
- Menú principal estilizado, con logo, fondo propio y marca VoliGames
- Crear partida privada (código de 4 letras) y unirse por código o link `?room=XXXX`
- Personalización: abrigos de cazador (colores desbloqueables)
- Perfil: nombre para mostrar
- Ajustes: botón preparado, todavía sin opciones
- Navegación entre pantallas
- Música de menú en bucle, con botón para silenciar

**Partida**
- Roles sorteados al empezar (1 cazador, el resto infiltrados)
- Los infiltrados ganan sobreviviendo **10 minutos** o completando la misión (techo, mesa, loma)
- El cazador gana cuando no queda ningún infiltrado en pie
- Escopeta con 8 cartuchos, 3 impactos para tumbar, penalización si le pegás a un NPC
- 3 cajas de munición en el mapa
- Manada de bolis NPC

**Cielo y ambiente**
- Ciclo día/noche, con amanecer y atardecer
- Sol y luna sincronizados con el reloj del mundo
- Cielo nocturno y transición hacia el día
- Estrellas, nubes, niebla e iluminación ambiental

**Herramientas de desarrollo**
- Consola de tiempo para pruebas (solo en localhost)

### En desarrollo / pendiente

- Mejorar los límites del mundo
- Remodelar y estilizar el terreno
- Texturas diferenciadas para césped, caminos y concreto
- Renovar cajas y objetos interactivos
- Remodelar estructuras
- Cambiar el modelo del arma
- Crear / reemplazar los modelos de personajes
- Completar la pantalla de Ajustes

---

## Capturas

Todavía no hay capturas de las pantallas en el repositorio. Cuando estén, conviene agregarlas acá:

- Menú principal
- Personalización
- Crear partida / lobby
- Otra pantalla relevante (por ejemplo el cielo o una partida)

---

## Controles

| Tecla | Acción |
| --- | --- |
| Clic | Capturar el mouse (cazador: disparar) |
| WASD | Caminar |
| Shift | Correr |
| C / Ctrl | Agachar |
| Q | Modo boli (infiltrado) |
| Esc | Opciones / volver al menú |

---

## Consola de debug

En **localhost**, F2, F8 o `` ` `` abre la consola de tiempo. Sirve para probar el cielo sin esperar toda la ronda.

```text
help
time
time +1
time -1
time +10
time -10
time set HH:MM
time pause
time resume
time speed <n>
```

---

## Desarrollo

```bash
npm install
npm run party:dev
npm run dev
```

`party:dev` (Wrangler) levanta las salas en `127.0.0.1:8787`. En producción el cliente usa `VITE_PARTYKIT_HOST`.
