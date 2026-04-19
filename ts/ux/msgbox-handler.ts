/**
 * WebRGSS msgbox → NeroUX/모달 표시용 어댑터
 *
 * RGSS msgbox 메시지를 파싱하여 variant/title/body로 변환하고,
 * 외부 showAlert 콜백으로 전달하는 핸들러를 생성합니다.
 * WebRGSS onMsgbox에 바인딩하여 NeroUX 모달과 연동할 수 있습니다.
 */
import { parseRgssScriptError } from '../utils/msgbox-parse';

export type MsgboxAlertVariant = 'info' | 'success' | 'warning' | 'error';

export interface MsgboxDisplayInfo {
  variant: MsgboxAlertVariant;
  title: string;
  body: string;
}

/**
 * RGSS msgbox 메시지를 모달 표시용 형식으로 변환
 */
export function formatMsgboxForDisplay(msg: string): MsgboxDisplayInfo {
  const scriptErr = parseRgssScriptError(msg);
  if (scriptErr) {
    return {
      variant: 'error',
      title: `스크립트 [${scriptErr.index}] ${scriptErr.title}`,
      body: msg,
    };
  }
  const isFileError =
    msg.includes('cannot open file') || msg.includes('load_data');
  return {
    variant: isFileError ? 'error' : 'info',
    title: 'RGSS',
    body: msg,
  };
}

export type ShowAlertFn = (
  variant: MsgboxAlertVariant,
  title: string,
  message: string
) => void | Promise<void>;

/**
 * NeroUX showAlert 등과 연동할 onMsgbox 핸들러 생성
 *
 * @example
 * const { showAlert } = useNeroUXModal();
 * const onMsgbox = createNeroUXMsgboxHandler(showAlert);
 * await WebRGSS.create({ ..., onMsgbox });
 */
export function createNeroUXMsgboxHandler(showAlert: ShowAlertFn): (msg: string) => void {
  return (msg: string) => {
    const { variant, title, body } = formatMsgboxForDisplay(msg);
    void showAlert(variant, title, body);
  };
}
