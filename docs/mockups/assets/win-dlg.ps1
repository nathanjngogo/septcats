# 窗口枚举 + #32770 对话框驱动（T80-05 探针用；纯 user32，不抢前台）
param([string]$Action = 'enum', [string]$DlgH = '', [string]$PathFile = '')
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;using System.Text;using System.Collections.Generic;public class E{
[DllImport("user32.dll")]public static extern bool EnumWindows(EnumProc cb,IntPtr l);
[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetWindowTextW(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern int GetClassNameW(IntPtr h,StringBuilder s,int n);
[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr FindWindowExW(IntPtr p,IntPtr e,string c,string n);
[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr SendMessageW(IntPtr m,uint msg,IntPtr wp,string lp);
[DllImport("user32.dll")]public static extern bool PostMessageW(IntPtr m,uint msg,IntPtr wp,IntPtr lp);
[DllImport("user32.dll")]public static extern int GetWindowTextLength(IntPtr h);
public static void PressKey(IntPtr h,int vk){PostMessageW(h,0x0100,(IntPtr)vk,IntPtr.Zero);PostMessageW(h,0x0101,(IntPtr)vk,IntPtr.Zero);}
public static void PressEnter(IntPtr h){PressKey(h,13);}
public static void PressEsc(IntPtr h){PressKey(h,27);}
public delegate bool EnumProc(IntPtr h,IntPtr l);
public static List<string> All(){var r=new List<string>();EnumWindows((h,l)=>{if(IsWindowVisible(h)){var sb=new StringBuilder(256);GetWindowTextW(h,sb,256);var cb=new StringBuilder(256);GetClassNameW(h,cb,256);uint p=0;GetWindowThreadProcessId(h,out p);r.Add((long)h+"|"+p+"|"+sb.ToString()+"|"+cb.ToString());}return true;},IntPtr.Zero);return r;}
public static IntPtr Edit(IntPtr top){IntPtr c=FindWindowExW(top,IntPtr.Zero,"Edit",string.Empty);if(c!=IntPtr.Zero)return c;IntPtr cb=FindWindowExW(top,IntPtr.Zero,"ComboBoxEx32",string.Empty);if(cb==IntPtr.Zero)cb=FindWindowExW(top,IntPtr.Zero,"ComboBox",string.Empty);if(cb!=IntPtr.Zero){IntPtr e=FindWindowExW(cb,IntPtr.Zero,"Edit",string.Empty);if(e!=IntPtr.Zero)return e;}return top;}
public static int ClickOpen(IntPtr top){int n=0;IntPtr b=FindWindowExW(top,IntPtr.Zero,"Button",string.Empty);while(b!=IntPtr.Zero){int l=GetWindowTextLength(b);var sb=new StringBuilder(l+2);GetWindowTextW(b,sb,sb.Capacity);string t=sb.ToString();if(t.Contains("打开")||t.Contains("Open")){PostMessageW(b,0x00F5,IntPtr.Zero,IntPtr.Zero);n++;}b=FindWindowExW(top,b,"Button",string.Empty);}return n;}
public static int ClickAnyButton(IntPtr top){int n=0;IntPtr b=FindWindowExW(top,IntPtr.Zero,"Button",string.Empty);while(b!=IntPtr.Zero){PostMessageW(b,0x00F5,IntPtr.Zero,IntPtr.Zero);n++;b=FindWindowExW(top,b,"Button",string.Empty);}return n;}
}'
if ($Action -eq 'enum') {
  foreach ($w in [E]::All()) { Write-Output $w }
  exit
}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
function Invoke-UIA($hwnd, $want) {
  $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
  if ($null -eq $root) { return 'NO-ELEMENT' }
  $eds = $root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
  $log = @()
  foreach ($e in $eds) {
    $ct = $e.Current.ControlType.ProgrammaticName
    $nm = $e.Current.Name
    if ($want -eq 'fillopen') {
      if ($ct -eq 'ControlType.Edit' -and $log -notcontains 'set') {
        try { $vp = $e.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern); $vp.Current.SetValue($script:Path); $log += 'set' } catch { $log += "set-fail:$($_.Exception.Message.Substring(0,[Math]::Min(60,$_.Exception.Message.Length)))" }
      }
      if ($nm -match '打开|Open' -and $log -notcontains 'open') {
        try { $ip = $e.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern); $ip.Invoke(); $log += 'open' } catch { $log += "open-fail:$($_.Exception.Message.Substring(0,[Math]::Min(60,$_.Exception.Message.Length)))" }
      }
    } else {
      if ($nm -match '取消|Cancel') {
        try { $ip = $e.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern); $ip.Invoke(); $log += 'cancel' } catch { $log += "cancel-fail" }
      }
    }
  }
  return ($log -join ',')
}
$h = [IntPtr]([int64]$DlgH)
if (-not [E]::IsWindowVisible($h)) { Write-Output 'DLG-GONE'; exit }
if ($Action -eq 'fillopen') {
  $script:Path = (Get-Content -LiteralPath $PathFile -Raw -Encoding UTF8).Trim()
  Write-Output ("UIA-FILLOPEN " + (Invoke-UIA $h 'fillopen'))
} elseif ($Action -eq 'cancel') {
  Write-Output ("UIA-CANCEL " + (Invoke-UIA $h 'cancel'))
} elseif ($Action -eq 'sendkeys') {
  # 对话框模态且新弹=前台；文件名框默认聚焦，直接敲路径+回车
  $p = (Get-Content -LiteralPath $PathFile -Raw -Encoding UTF8).Trim()
  $wsh = New-Object -ComObject WScript.Shell
  Start-Sleep -Milliseconds 400
  [void]$wsh.SendKeys('^a')
  [void]$wsh.SendKeys($p)
  [void]$wsh.SendKeys('~')
  Write-Output "SENDKEYS-DONE"
} elseif ($Action -eq 'sendesc') {
  $wsh = New-Object -ComObject WScript.Shell
  [void]$wsh.SendKeys('{ESC}')
  Write-Output "SENDESC-DONE"
}
