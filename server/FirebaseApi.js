const admin = require("firebase-admin");
const serviceAccount = require("./firebase_skey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://trustedsetup-a86f4.firebaseio.com"
});

const db = admin.firestore();

async function getFBSummaries() {
  const ceremonySummariesSnapshot = await db.collection("ceremonies").get();
  const fbSummaries = [];
  ceremonySummariesSnapshot.forEach(doc => {
    fbSummaries.push(firebaseCeremonyJsonToSummary({id: doc.id, ...doc.data()}));
  });
  return fbSummaries;
}

async function getFBSummary(id) {
  const doc = await db
    .collection("ceremonies")
    .doc(id)
    .get();
  if (!doc.exists) {
    throw new Error("ceremony not found");
  }
  return firebaseCeremonyJsonToSummary({id: doc.id, ...doc.data()});
}

async function getFBCeremony(id) {
  const doc = await db
    .collection("ceremonies")
    .doc(id)
    .get();
  if (!doc.exists) {
    throw new Error("ceremony not found");
  }
  console.log(`getFBCeremony ${doc.exists}`);
  const missingParticipants = firebaseCeremonyJsonToSummary(doc.data());
  const ceremony = {
    ...missingParticipants,
  };
  return ceremony;
}

async function updateFBSummary(newCeremonySummary) {
  // updates firebase ceremony doc by updating the fields present in newCeremonySummary
  // we never delete fields
  const docRef = await db.collection("ceremonies").doc(newCeremonySummary.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new Error(
      `ceremony with id ${newCeremonySummary.id} does not exist.`
    );
  }
  await docRef.set(
    {
      ...newCeremonySummary,
      lastSummaryUpdate: new Date()
    },
    { merge: true }
  );
}

async function updateFBCeremony(newCeremony) {
  // updates firebase ceremony doc by updating the fields present in newCeremony
  // updates the participants in newCeremony.participants in firebase ceremony's participants subsection (present fields only)
  // we never delete fields
  const docRef = db.collection("ceremonies").doc(newCeremony.id);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new Error(`ceremony with id ${newCeremony.id} does not exist.`);
  }
  const { participants, ...rest } = newCeremony;
  const summaryUpdatePromise = docRef.set(
    {
      ...rest,
      lastSummaryUpdate: new Date(),
    },
    { merge: true }
  );
}

async function fbCeremonyExists(id) {
  const docRef = db.collection("ceremonies").doc(id);
  return (await docRef.get()).exists;
}

async function addFBCeremony(summaryData) {
  try {
    const doc = await db.collection("ceremonies").add(summaryData);

    console.log(`new ceremony added with id ${doc.id}`)
    return doc.id;
  } catch (e) {
    throw new Error(`error adding ceremony data to firebase: ${e}`);
  }
}

async function addParticipant(ceremonyId, participant) {
  participant.messages = [];
  const participantRef = db
    .collection("ceremonyParticipants")
    .doc(ceremonyId)
    .collection("participants")
    .doc(participant.address.toLowerCase());
  return participantRef.set(participant);
}

//TODO - deprecated  - use ceremonies/*/events
async function addCeremonyEvent(event) {
  try {
    const doc = await db
      .collection("ceremonyEvents")
      .add(event);
    console.log(`Event added for ceremony ${event.ceremonyId}. Id: ${doc.id}`);
  } catch (e) {
    throw new Error(`error adding ceremony event to firebase: ${e}`);
  }
};

async function addStatusUpdateEvent(ceremonyId, message) {
  try {
    const event = {
      timestamp: new Date(),
      acknowledged: false,
      eventType: 'STATUS_UPDATE',
      sender: 'SERVER',
      message,
    }
    const doc = await db
      .collection("ceremonies")
      .doc(ceremonyId)
      .collection('events')
      .add(event);
    console.log(`Event added for ceremony ${ceremonyId}. Id: ${doc.id}`);
  } catch (e) {
    throw new Error(`error adding ceremony event to firebase: ${e}`);
  }

}

function firebaseCeremonyJsonToSummary(json) {
  for (const prop of [
    "lastSummaryUpdate",
    "startTime",
    "endTime",
    "completedAt"
  ]) {
    if (json[prop] !== undefined) {
      json[prop] = json[prop].toDate();
    }
  }
  return json;
}

function firebaseParticipantJsonToParticipant(json) {
  for (const prop of [
    "lastVerified",
    "addedAt",
    "startedAt",
    "completedAt",
    "lastUpdate"
  ]) {
    if (json[prop] !== undefined) {
      json[prop] = json[prop].toDate();
    }
  }
  return json;
}

const ceremonyEventListener = async (circuitFileUpdateHandler, verifyContribution) => {
  console.log(`starting events listener...`);
  try {
    const eventsCollection = db.collectionGroup("events");
    const query = eventsCollection.where('acknowledged', '==', false)
        .where('eventType', 'in', ['CIRCUIT_FILE_UPLOAD', 'PARAMS_UPLOADED']);
    
    const snap = await query.get();
    console.debug(`snap ${snap.size}`);

    query.onSnapshot(querySnapshot => {
      console.log(`Ceremony events notified: ${JSON.stringify(querySnapshot.docChanges().length)}`);
      querySnapshot.docChanges().forEach(docSnapshot => {
        console.debug(`changed doc: ${docSnapshot.type}`);
        if (docSnapshot.type !== 'removed') {
          var event = docSnapshot.doc.data();
          const ceremony = docSnapshot.doc.ref.parent.parent;
          console.debug(`Event: ${JSON.stringify(event)} ceremony Id: ${ceremony.id}`);
          switch (event.eventType) {
            case 'CIRCUIT_FILE_UPLOAD': {
              // Coordinator advises that r1cs file has been uploaded
              // Handle the r1cs file
              console.debug(`Have CIRCUIT_FILE_UPLOAD event`)
              circuitFileUpdateHandler(ceremony.id); // This happens asynchronously
              docSnapshot.doc.ref.update({acknowledged: true});
              break;
            }
            case 'PARAMS_UPLOADED': {
              // Participant advises that contrib file has been uploaded
              // DO the steps to verify it
              console.debug(`Have PARAMS_UPLOADED event`)
              verifyContribution(ceremony.id, event.index);
              docSnapshot.doc.ref.update({acknowledged: true});
              break;
            }
            case 'PREPARED': { break; }
            case 'CREATE': { break; }
          }
      }});
    }, err => {
      console.log(`Error while listening for ceremony events ${err}`);
    });
  } catch (err) {
    console.error(`Error caught in ceremonyEventListener ${err.message}`);
  }
};

module.exports = {
  getFBSummaries,
  getFBSummary,
  getFBCeremony,
  updateFBSummary,
  updateFBCeremony,
  fbCeremonyExists,
  addFBCeremony,
  addCeremonyEvent,
  ceremonyEventListener,
  addStatusUpdateEvent,
};
