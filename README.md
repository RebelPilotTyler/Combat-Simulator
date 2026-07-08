# D&D 5e-Style Combat Sandbox

Ugly but functional local combat simulator for manually testing homebrew encounters.

## Commands

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Run engine tests:

```bash
npm test
```

Build for production:

```bash
npm run build
```

On Windows PowerShell, if script execution blocks `npm`, use `npm.cmd` instead:

```bash
npm.cmd run dev
npm.cmd test
```

## Basic Controls

- Roll initiative before using turn controls.
- The active creature's movement range is highlighted in green while Move mode is selected.
- Click a highlighted grid square to move the active creature. One square is 5 feet.
- Movement cannot end on occupied cells and pathing avoids blocked cells.
- Pick a basic action from the active creature panel. Dash and Dodge are implemented; other basics are visible placeholders.
- The basic action option fields provide shared inputs for Help, Ready, Search, Use an Object, Grapple, Shove, and Improvised Action.
- Cast a Spell selects the first creature action tagged as a spell; spell slots are not tracked yet.
- Creature actions are grouped by Action, Bonus Action, Reaction, and Free.
- Bonus actions and reactions have separate per-turn resources from the main action.
- Moving out of enemy melee reach creates a pending opportunity attack prompt unless Disengage or a blocking condition prevents it.
- Pending reactions can be used or skipped from the prompt near the top of the app.
- Ranged attacks made while a conscious hostile creature is within 5 feet roll with disadvantage.
- Use the initiative tracker to see turn order, HP, and condition tags at a glance.
- Creature tokens show initials, a compact HP bar, and condition tags.
- Pick a creature action, choose/click a target or area, then use Apply Action to resolve attacks and saving throw effects.
- Attack, Dash, Dodge, and placeholder basic actions consume the active creature's action for the turn.
- Use Cancel Selection to return to movement mode.
- The Dev / Test Tools panel can apply damage, heal, and apply/remove conditions from the selected creature.
- Use Export Current and Load JSON to round-trip the combat state.

## Notes

- The combat engine lives in `src/engine` and is pure TypeScript.
- The UI is a Vite + React + TypeScript app with no backend.
- Sample creatures are generic and intentionally avoid official copyrighted statblocks or spell lists.
