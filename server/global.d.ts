import Global = NodeJS.Global;
type eventAction = (data?: any) => void;
export default interface GlobalThis extends Global {
  log: any;
  color: any;
}
