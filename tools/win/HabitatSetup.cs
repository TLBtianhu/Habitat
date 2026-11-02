using System;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32;

internal static class HabitatSetupProgram
{
    private static int Main(string[] args)
    {
        try
        {
            var action = args.Length > 0 ? args[0] : "upgrade";
            var exeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            var clientDir = Environment.GetEnvironmentVariable("HABITAT_CLIENT_DIR") as string;
            if (string.IsNullOrEmpty(clientDir)) clientDir = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Habitat", "ClientDir", null) as string;
            var payloadRoot = action == "uninstall" && !string.IsNullOrEmpty(clientDir) ? clientDir : Directory.GetParent(Directory.GetParent(exeDir).FullName).FullName;
            var script = action == "uninstall" && !string.IsNullOrEmpty(clientDir)
                ? Path.Combine(clientDir, "tools", "win", "setup.ps1")
                : Path.Combine(exeDir, "setup.ps1");
            var package = args.Length > 1 ? args[1] : Path.Combine(Directory.GetParent(Directory.GetParent(exeDir).FullName).FullName, "payload", "fishbowl-v0.1.zip");
            var installRoot = args.Length > 2 ? args[2] : null;
            if (string.IsNullOrEmpty(installRoot)) installRoot = Environment.GetEnvironmentVariable("HABITAT_INSTALL_ROOT");
            if (string.IsNullOrEmpty(installRoot)) installRoot = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Habitat", "InstallRoot", "") as string ?? "";
            if (!File.Exists(script))
            {
                Console.Error.WriteLine("Habitat setup script is missing: " + script);
                return 2;
            }
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
                Arguments = string.Format("-NoProfile -ExecutionPolicy Bypass -File \"{0}\" -Action {1} -PackagePath \"{2}\" -PayloadRoot \"{3}\" -InstallRoot \"{4}\"", script, action, package, payloadRoot, installRoot),
                UseShellExecute = false,
                CreateNoWindow = false,
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
