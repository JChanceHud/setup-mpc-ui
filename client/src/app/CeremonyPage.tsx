import { Link, RouteProps, useParams } from "react-router-dom";
import { useState, useEffect, useRef, useContext } from "react";
import * as React from "react";
import styled from "styled-components";
import { ReactNode } from "react";
import { DataGrid, ColDef, ValueGetterParams } from '@material-ui/data-grid';
import {
  textColor,
  lighterBackground,
  accentColor,
  PageContainer,
  secondAccent,
  CeremonyTitle,
  Center
} from "../styles";
import { Ceremony, Contribution, ContributionSummary, Participant } from "../types/ceremony";
import { ceremonyUpdateListener, contributionUpdateListener, getCeremony } from "../api/FirestoreApi";
import { createStyles, makeStyles, Theme, Typography, withStyles, Container } from "@material-ui/core";
import Fab from '@material-ui/core/Fab';
import EditIcon from '@material-ui/icons/Edit';
import CloseIcon from '@material-ui/icons/Close';
import moment from "moment";
import './styles.css';
import { AuthContext } from "./AuthContext";
import { SelectedCeremonyContext, useSelectionContext } from "./SelectionContext";

const CeremonyDetailsTable = styled.table`
  text-align: right;
  font-size: 11pt;
  width: 100%;

  td.title {
    padding-left: 10px;
    color: ${accentColor};
  }
  td.content {
    padding-left: 10px;
    float: left;
    color: ${textColor};
  }
`;

const NotFoundContainer = styled.div`
  width: 512px;
  background-color: ${lighterBackground};
  padding: 16px;
  border-radius: 4px;
  text-align: center;
`;

const CeremonyDetailsContainer = styled.div`
  width: 512px;
  background-color: ${lighterBackground};
  padding: 16px;
  border-radius: 4px;
`;

const CeremonyDetailsSubSection = styled.div`
  width: 100%;
  display: inline-block;
  padding: 16px;
  box-sizing: border-box;
`;

export const CeremonyPage = (props: {onClose: ()=> void }) => {
  const [loaded, setLoaded] = useState<boolean>(false);
  const [ceremony, setCeremony] = useState<null | Ceremony>(null);
  const [contributions, setContributions] = useState<ContributionSummary[]>([]);
  const ceremonyListenerUnsub = useRef<(() => void) | null>(null);
  const contributionListenerUnsub = useRef<(() => void) | null>(null);
  const loadingContributions = useRef(false);
  const [selection, dispatch] = useSelectionContext();

  let { ceremonyId } = selection;
  console.log(`have id ${ceremonyId}`);

  const refreshCeremony = async () => {
    const c = ceremonyId ? await getCeremony(ceremonyId) : undefined;
    if (c !== undefined) setCeremony(c);
  };

  const updateContribution = (doc: ContributionSummary, changeType: string, oldIndex?: number) => {
    // A contribution has been updated
    console.log(`contribution update: ${doc.queueIndex} ${changeType} ${oldIndex}`);
    let newContributions = contributions;
    switch (changeType) {
      case 'added': {
        newContributions.push(doc);
        break;
      }
      case 'modified': {
        if (oldIndex !== undefined) newContributions[oldIndex] = doc;
        break;
      }
      case 'removed': {
        if (oldIndex !== undefined) newContributions.splice(oldIndex, 1);
        break;
      }
    }
    setContributions(newContributions);
  }

  if (!loaded) {
    refreshCeremony()
      .then(() => setLoaded(true));
  }


  if (!ceremonyListenerUnsub.current && selection.selectedCeremony) {
    // Start ceremony listener
    ceremonyUpdateListener(selection.selectedCeremony, setCeremony)
        .then(unsub => ceremonyListenerUnsub.current = unsub);
  }

  if (!loadingContributions.current && selection.selectedCeremony) {
    // Start contribution listener
    contributionUpdateListener(selection.selectedCeremony, updateContribution)
        .then(unsub => contributionListenerUnsub.current = unsub);
    loadingContributions.current = true;
  }

  const gridRows = contributions.map(v => {
    return {
      ...v, 
      id: v.queueIndex,
      timestamp: v.timeCompleted ? moment(v.timeCompleted.toDate()).format('lll') : '',
      duration: `${Math.round(moment.duration(v.duration, 'seconds').asMinutes())}m`,
    }
  });

  const contributionStats = (): {completed: number, waiting: number} => {
    let result = {completed: 0, waiting: 0};
    contributions.forEach(c => {
      switch (c.status) {
        case 'COMPLETE': result.completed++; break;
        case 'WAITING': result.waiting++; break;
      }
    });
    return result;
  }

  const contribStats = contributionStats();

  const handleEdit = () => {
    dispatch({ type: 'EDIT_CEREMONY', selectedCeremony: ceremonyId });
  };

  const handleClose = () => {
    if (ceremonyListenerUnsub.current) ceremonyListenerUnsub.current();
    if (contributionListenerUnsub.current) contributionListenerUnsub.current();
    props.onClose();
  };

  return (
    <>
      {ceremony ? (
        <PageContainer >
          <br />
          <div style={{ width: '80%', display: 'flex' }}>
            <div style={{ marginLeft: 'auto' }}>
              <CeremonyDetails 
                ceremony={ceremony} 
                numContCompleted={contribStats.completed} 
                numContWaiting={contribStats.waiting} />
            </div>
            <div style={{ float: 'right', marginLeft: 'auto' }}>
              <Actions handleEdit={handleEdit} handleClose={handleClose} />
            </div>
          </div>
          <br />
          <ContributionsGrid contributions={gridRows} />
        </PageContainer>
      ) : (
        <PageContainer>
          <br />
          <NotFoundContainer>
            {loaded ? "Ceremony not found." : "Loading..."}
          </NotFoundContainer>
        </PageContainer>
      )}
    </>
  );
};

const Actions = (props: {handleEdit: ()=>void, handleClose: ()=> void}) => {
  return (
    <AuthContext.Consumer>{Auth => {
      return (<div>
        {Auth.isCoordinator ?
          (<Fab 
            variant="round" 
            onClick={props.handleEdit}
            aria-label="edit">
            <EditIcon />
          </Fab>) 
          : (<></>)
        }
        <Fab 
          variant="round" 
          onClick={props.handleClose}
          aria-label="close">
          <CloseIcon />
        </Fab>
      </div>
      )}}
    </AuthContext.Consumer>
  );
}

const CeremonyDetails = (props: { ceremony: Ceremony, numContCompleted: number, numContWaiting: number  }) => {
  console.debug(`start ${props.ceremony.startTime}`);

  return (
    <CeremonyDetailsContainer>
      <CeremonyTitle>{props.ceremony.title}</CeremonyTitle>
      <CeremonyDetailsSubSection>
        <Center>
          <CeremonyDetailsTable>
            <tbody>
              <tr>
                <td className='title'>Status</td>
                <td className='content'>{props.ceremony.ceremonyState}</td>
              </tr>
              <tr>
                <td className='title'>Start Time</td>
                <td className='content'>{moment(props.ceremony.startTime).format('lll')}</td>
              </tr>
              <tr>
                <td className='title'>End Time</td>
                <td className='content'>{props.ceremony.endTime ? moment(props.ceremony.endTime).format('lll') : ''}</td>
              </tr>
              <tr>
                <td className='title'>Minimum Participants</td>
                <td className='content'>{props.ceremony.minParticipants}</td>
              </tr>
              <tr>
                <td className='title'>Contributions</td>
                <td className='content'>{props.numContCompleted} completed, {props.numContWaiting} waiting</td>
              </tr>
            </tbody>
          </CeremonyDetailsTable>
        </Center>
      </CeremonyDetailsSubSection>
      <CeremonyDetailsSubSection>
        {props.ceremony.description}
      </CeremonyDetailsSubSection>
    </CeremonyDetailsContainer>
  );
};

const columns: ColDef[] = [
  { field: 'queueIndex', headerName: '#', description: 'Queue position', type: 'number', width: 50, sortable: true },
  { field: 'timestamp', headerName: 'Time', width: 180, sortable: true },
  { field: 'status', headerName: 'Status', width: 120, sortable: false },
  { field: 'duration', headerName: 'Duration', type: 'string', width: 90, sortable: false },
  { field: 'hash', 
    headerName: 'Hash',
    description: 'The hash resulting from this contribution',
    sortable: false,
    width: 180,
    //valueGetter: (params: ValueGetterParams) =>
    //  `${params.getValue('hash')}`,
  },
];

const ContributionsGrid = (props: {contributions: any[]}) => {
  //const classes = useStyles();
  return (
    <div style={{ height: 450, width: 800 }}>
      <Typography variant="h5" style={{ color: accentColor, background: lighterBackground }}>Contributions</Typography>
      <DataGrid 
        rows={props.contributions} 
        columns={columns} 
        pageSize={8}
        rowHeight={40}
        sortingMode='server'
      />
    </div>
  );
}
