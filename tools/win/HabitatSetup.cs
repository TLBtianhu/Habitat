using System;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32;

internal static class HabitatSetupProgram
{
    private static string ExtractPayload()
    {
        var root = Path.Combine(Path.GetTempPath(), "HabitatSetupPayload-" + Guid.NewGuid().ToString("N"));
        var assembly = System.Reflection.Assembly.GetExecutingAssembly();
        foreach (var name in assembly.GetManifestResourceNames())
        {
            string relative;
            if (name == "HabitatConsole.exe") relative = "tools/win/HabitatConsole.exe";
            else if (name.StartsWith("payload.")) relative = "payload/" + name.Substring("payload.".Length);
            else if (name.StartsWith("runtime.")) relative = "runtime/" + name.Substring("runtime.".Length);
            else if (name.StartsWith("tools.win.")) relative = "tools/win/" + name.Substring("tools.win.".Length);
            else continue;
            var destination = Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(destination));
            using (var input = assembly.GetManifestResourceStream(name))
            using (var output = File.Create(destination)) input.CopyTo(output);
        }
        var setupCopy = Path.Combine(root, "tools", "win", "HabitatSetup.exe");
        Directory.CreateDirectory(Path.GetDirectoryName(setupCopy));
        File.Copy(assembly.Location, setupCopy, true);
        return root;
    }

    private static int Main(string[] args)
    {
        string extracted = null;
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
            if (!File.Exists(script))
            {
                extracted = ExtractPayload();
                payloadRoot = extracted;
                script = Path.Combine(extracted, "tools", "win", "setup.ps1");
            }
            var package = args.Length > 1 ? args[1] : Path.Combine(payloadRoot, "payload", "fishbowl-v0.1.zip");
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
        finally
        {
            if (!string.IsNullOrEmpty(extracted))
            {
                try { Directory.Delete(extracted, true); } catch { }
            }
        }
    }
}
