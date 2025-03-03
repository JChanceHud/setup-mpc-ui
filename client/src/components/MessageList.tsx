import React from 'react';
import { createStyles, makeStyles, Theme } from '@material-ui/core/styles';
import ListItem from '@material-ui/core/ListItem';
import ListItemText from '@material-ui/core/ListItemText';
import { VariableSizeList, ListChildComponentProps } from 'react-window';
import {
    textColor,
    lighterBackground,
    accentColor,
    PageContainer,
    secondAccent,
    CeremonyTitle,
    Center
  } from "../styles";
  
const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    root: {
      width: '100%',
      height: 400,
      maxWidth: 300,
      backgroundColor: lighterBackground,
      color: textColor,
    },
  }),
);

function renderRow(props: ListChildComponentProps) {
  const { data, index, style } = props;

  return (
    <ListItem button style={style} key={index}>
      <ListItemText primary={`${data[index]}`} />
    </ListItem>
  );
}

export default function VirtualizedList(props: {messages: string[]}) {
  //const classes = useStyles();
  const {messages} = props;
  const listRef = React.useRef<VariableSizeList>(null);

  const rowHeight = (index: number) => {
    let lines = Math.floor(messages[index].length / 80) + 1;
    return (lines * 30);
  }

  if (listRef.current && messages && messages.length > 5) listRef.current.scrollToItem(messages.length - 1, 'end');
  
  return (
    <div>
      <VariableSizeList 
        height={200} width={600} 
        itemSize={rowHeight} 
        itemCount={messages.length} 
        itemData={messages}
        ref={listRef}
      >
        {renderRow}
      </VariableSizeList>
    </div>
  );
}
