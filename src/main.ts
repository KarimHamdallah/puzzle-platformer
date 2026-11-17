import './style.css';
import { DEBUG_ENABLED, Engine } from './engine';
import { ActionNames, BindKeys } from './game/Actions';
import { LoadAssets } from './game/Assets';
import { M1Easy, M1Hard, M1Medium } from './game/levels/Mechanic1';
import { M2Easy, M2Hard, M2Medium } from './game/levels/Mechanic2';
import { M3Easy, M3Hard, M3Medium } from './game/levels/Mechanic3';
import { MenuState } from './game/states/MenuState';
import { PlaygroundState } from './game/states/PlaygroundState';
import { StateId } from './game/states/StateId';

// Render at 1920x1080, scaled to fit the window. Gameplay and physics step at a fixed 60 Hz.
const engine = new Engine({ width: 1920, height: 1080, fixedDt: 1 / 60, background: 0x3b3a2c, parent: 'game' });

BindKeys(engine.input);
if (DEBUG_ENABLED) engine.input.CreateDebugFolder(ActionNames());
LoadAssets(engine);

// One state per screen. Every start builds a NEW object, so a restarted level has no leftovers.
engine.states.Register(StateId.Menu, (e) => new MenuState(e));
engine.states.Register(StateId.Playground, (e) => new PlaygroundState(e));
engine.states.Register(StateId.M1Easy, (e) => new M1Easy(e));
engine.states.Register(StateId.M1Medium, (e) => new M1Medium(e));
engine.states.Register(StateId.M1Hard, (e) => new M1Hard(e));
engine.states.Register(StateId.M2Easy, (e) => new M2Easy(e));
engine.states.Register(StateId.M2Medium, (e) => new M2Medium(e));
engine.states.Register(StateId.M2Hard, (e) => new M2Hard(e));
engine.states.Register(StateId.M3Easy, (e) => new M3Easy(e));
engine.states.Register(StateId.M3Medium, (e) => new M3Medium(e));
engine.states.Register(StateId.M3Hard, (e) => new M3Hard(e));

engine.Run(StateId.Menu);

// Console access while debugging: __engine.states.current
if (DEBUG_ENABLED) (window as unknown as { __engine: Engine }).__engine = engine;
