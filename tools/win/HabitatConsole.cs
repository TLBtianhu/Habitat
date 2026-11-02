using System;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32;

internal static class HabitatConsoleProgram
{
    private static int Main(string[] args)
    {
        try
        {
            var exeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            var clientDir = Environment.GetEnvironmentVariable("HABITAT_CLIENT_DIR") as string;
            if (string.IsNullOrEmpty(clientDir)) clientDir = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Habitat", "ClientDir", null) as string;
            var script = string.IsNullOrEmpty(clientDir)
                ? Path.Combine(exeDir, "client.ps1")
                : Path.Combine(clientDir, "tools", "win", "client.ps1");
            if (!File.Exists(script))
            {
                Console.Error.WriteLine("Habitat client script is missing: " + script);
                return 2;
            }
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = string.Format("-NoProfile -ExecutionPolicy Bypass -File \"{0}\"", script),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using (var process = Process.Start(psi))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
