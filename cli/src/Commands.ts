import * as chalk from 'chalk';
import login from './Login';
import { getState, setState, StateChange } from './State';
import { addCeremonyEvent, addOrUpdateContribution, ceremonyQueueListener,
    ceremonyQueueListenerUnsub, getCeremonies, getEligibleCeremonies,
    joinCeremony as joinCeremonyApi } from './api/FirestoreApi';
import { getParamsFile, uploadParams } from './api/FileApi';
import * as path from 'path';

import { CeremonyEvent, Contribution, ContributionState } from './types/ceremony';

const Logger = require('js-logger');
Logger.useDefaults();
// const consoleHandler = Logger.createDefaultHandler();
// Logger.setHandler((m, c) => {
//     consoleHandler(m,c);
// });

const snarkjs = require('snarkjs');

const commandHandler = () => {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.green('ZKParty> ')
    });

    rl.prompt();
    rl.on('line', async (line) => {
        await parseCommand(line.trim(), rl);
        rl.prompt();
    }).on('close', () => {
        console.log('Bye');
        process.exit(0);
    });
};

const parseCommand = async (command: string, rl) => {
    if (command && command.length > 0) {
        const cmdList = allowedCommands();
        switch (command) {
            case 'help':
            case '?':
                console.log(`Available commands: ${cmdList}`);
                break;
            case 'quit':
                rl.close();
                break;
            default:
                if (commandIsAllowed(command, cmdList)) {
                    const cmdArgs = command.split(' ');
                    switch (cmdArgs[0]) {
                        case 'login': 
                            await login();
                            break;
                        case 'logout':
                            setState(StateChange.LOGOUT);
                            break;
                        case 'list':
                            await listCeremonies();
                            break;
                        case 'join':
                            if (cmdArgs.length > 1)
                                await joinCeremony(cmdArgs[1])
                            else {
                                console.log(`Please nominate a ceremony number to join`);
                            }
                            break;
                        case 'entropy':
                            await getEntropy(rl, cmdArgs.length > 1 ? cmdArgs[1]: null);
                            break;
                        case 'download':
                            await download();
                            break;
                        case 'run':
                            setState(StateChange.AUTO_RUN);;
                            break;
                        case 'compute':
                            await compute();
                            break;
                        case 'upload':
                            await upload();
                            break;
                        case 'verify':
                            await verify();
                            break;
                        case 'attest':
                            await attest();
                            break;
                        default: 
                            console.log(`Unrecognized command '${command}'`);
                    }
                } else {                    
                    console.log(`Command not available`);
                }
        }
    }
}

const commandIsAllowed = (cmd: string, cmdList: string[]): boolean => {
    return cmdList.some(v => cmd.startsWith(v));
}


const allowedCommands = (): string[] => {
    const state = getState();
    let cmds = ['quit', 'help', '?', 'list'];
    cmds.push( state.loggedIn ? 'logout' : 'login');
    if (state.listed) cmds.push('join');
    if (state.joined && !state.computed) {
        cmds.push('entropy');
        if (state.haveEntropy && !state.autoRun) cmds.push('run');
    }
    if (!state.autoRun) {
        if (state.joined && !state.waiting && !state.computed) cmds.push('download');
        if (state.downloaded && state.haveEntropy && !state.computed) cmds.push('compute');
        if (state.computed) cmds.push('upload');
    }
    if (state.uploaded) cmds.push('verify', 'attest');
    return cmds;
}

const listCeremonies = async () => {
    const state = getState();

    let ceremonies = [];
    if (state.loggedIn) {
        ceremonies = await getEligibleCeremonies(state.user.uid)
        console.debug(`ceremonies: ${ceremonies.length}`);
        setState(StateChange.LISTED, ceremonies);
    } else {
        ceremonies = await getCeremonies();
    }
    console.log(chalk.greenBright.underline('Ceremonies'));
    let i = 1;
    ceremonies.forEach(c => {
        console.log(chalk.green(`${i++}. ${c.title}`));
    });
};


const joinCeremony = async (arg: string) => {
    const state = getState();
    try {
        const c = parseInt(arg);
        if ((c > 0) && (c <= state.ceremonyList.length)) {
            const ceremony = state.ceremonyList[c-1];
            console.log(`Joining ${ceremony.title} ...`);
            // Add contribution to DB (WAITING)
            const contribState = await joinCeremonyApi(ceremony.id, state.user.uid);
            // Start queue listener
            ceremonyQueueListener(ceremony.id, updateQueue);
            // Set local state
            setState(StateChange.JOINED, {index: c-1, contribState});
        } else {
            console.log('Invalid argument');
        }
    } catch (err) {
        console.log(`Error: ${err.message}`);
    }
};

const updateQueue = (cs: ContributionState) => {
    const state = getState();
    const myIndex = state.contributionState.queueIndex;
    console.debug(`my index is ${myIndex}`);
    // Check the new index - is it out turn?
    if (myIndex == cs.currentIndex) {
        // Yes
        console.log(chalk.greenBright(`It is your turn to contribute`));
        // Unsubscribe to contribution updates
        if (ceremonyQueueListenerUnsub) ceremonyQueueListenerUnsub();
        // Cancel waiting state
        setState(StateChange.WAIT_DONE);
        // Are we running on auto? If so, start the process
        if (state.autoRun) {
            runCeremony();
        }
    } else {
        console.log(`Participant ${cs.currentIndex} is starting their turn`);
    }
}

const getEntropy = async (rl, arg?: string) => {
    if (arg && arg.length > 1) {
        setState(StateChange.SET_ENTROPY, arg);
        return;
    }
    // Collect entropy
    await new Promise(resolve => {
        rl.question(
            'Enter random text to be used as your entropy:', (ent: string) => {
                if (ent && ent.length>0) {
                    setState(StateChange.SET_ENTROPY, ent);
                    console.log('Entropy saved');
                    resolve(ent);
                }
            }
        );
    });
};

const runCeremony = async () => {
    // Called when waiting is finished (notified via queue update)
    // download
    await download();
    // compute
    await compute();
    // upload
    await upload();
};

const download = async () => {
    const state = getState();
    const ceremonyId = state.ceremonyList[state.selectedCeremony].id;
    console.log(`Downloading prior contributor's data...`);
    addCeremonyEvent(ceremonyId, createCeremonyEvent(
        "START_CONTRIBUTION",
        `Starting turn for index ${state.contributionState.currentIndex}`,
        state.contributionState.currentIndex
    ));
    const contribution: Contribution = {
        participantId: state.user.uid || '??',
        participantAuthId: state.user?.authId || 'anonymous',
        queueIndex: state.contributionState.queueIndex,
        priorIndex: state.contributionState.lastValidIndex,
        lastSeen: new Date(),
        status: "RUNNING",
    };
    addOrUpdateContribution(ceremonyId, contribution);

    setState(StateChange.UPDATE_CONTRIBUTION_STATUS, {
        startTime: new Date()
    });

    const oldFilePath = path.join(__dirname, '..', '..', 'data', `ph2_${state.contributionState.lastValidIndex}.params`);
    await getParamsFile(ceremonyId, state.contributionState.lastValidIndex, oldFilePath)
        .catch(err => { 
            console.error(chalk.red(`Error downloading file: ${err.message}`));
            return; // TODO - INVALIDATE
        });
    
    console.log(chalk.greenBright(`Params file downloaded ${oldFilePath}`));

    setState(StateChange.DOWNLOADED, oldFilePath);
};

export const createCeremonyEvent = (eventType: string, message: string, index: number | undefined): CeremonyEvent => {
    return {
        sender: "PARTICIPANT",
        index,
        eventType,
        timestamp: new Date(),
        message,
        acknowledged: false,
    };
};

const compute = async () => {
    const state = getState();
    const ceremonyId = state.ceremonyList[state.selectedCeremony].id;
    // 
    const oldFilePath = state.oldFile;
    const consoleLogger = Logger.get('console');
    // convert to zkey
    const dataPath = path.join(__dirname, '..', '..', 'data'); 
    const priorZkey = path.join(dataPath, 'ph2_0055.zkey');
    const oldZkey = path.join(dataPath, 'old.zkey');
    const username = `${state.user.username || 'anonymous'}`;
    console.debug(`import params...`);
    await snarkjs.zKey.importBellman(priorZkey, oldFilePath, oldZkey, username, consoleLogger);
    console.log(`Convert to zkey done`);

    // newFilePath
    const newZkey = path.join(dataPath, `ph2_${state.contributionState.queueIndex}.zkey`);

    // call snarkjs to contribute 
    let entropy = state.entropy;
    await snarkjs.zKey.contribute(oldZkey, newZkey, username, entropy, consoleLogger);
    entropy = null;
    console.log(`Contribute done`);

    // convert to params
    const newParams = path.join(dataPath, 'new.params');
    await snarkjs.zKey.exportBellman(newZkey, newParams, consoleLogger);
    addCeremonyEvent(ceremonyId, createCeremonyEvent(
        "COMPUTE_DONE",
        `Contribution computation finished`,
        state.contributionState.currentIndex
    ));
    
    setState(StateChange.COMPUTED, newParams);
    console.log('Compute done');
};

const upload = async () => {
    const state = getState();
    const ceremonyId = state.ceremonyList[state.selectedCeremony].id;
    console.log(`Uploading data...`);
    addCeremonyEvent(ceremonyId, createCeremonyEvent(
        "START_UPLOAD",
        `Starting upload (CLI)`,
        state.contributionState.currentIndex
    ));

    await uploadParams(ceremonyId, state.contributionState.currentIndex, state.newFile, updateProgress);
    console.debug(`upload done`);
    addCeremonyEvent(ceremonyId, createCeremonyEvent(
        "START_UPLOAD",
        `Starting upload (CLI)`,
        state.contributionState.currentIndex
    ));
};

const updateProgress = (progress: number) => {
    console.debug(`Progress: ${progress}`);
};

const verify = async () => {
    const state = getState();
};

const attest = async () => {};

export default commandHandler;
