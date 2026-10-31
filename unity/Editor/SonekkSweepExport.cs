using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Sonekk.Sweep
{
    /// <summary>
    /// Exports the open scene to the JSON format consumed by the sonekk-sweep CLI.
    /// Render meshes are baked to world space, colliders are baked to primitives so the
    /// checker never needs Unity's physics engine.
    /// </summary>
    public static class SonekkSweepExport
    {
        [MenuItem("Tools/Sonekk Sweep/Export Scene")]
        public static void ExportScene()
        {
            var path = EditorUtility.SaveFilePanel("Export scene for Sonekk Sweep", "", "sweepmap.json", "json");
            if (string.IsNullOrEmpty(path)) return;

            var json = BuildJson();
            File.WriteAllText(path, json);
            Debug.Log($"[Sonekk Sweep] exported to {path} ({json.Length} bytes)");
            EditorUtility.RevealInFinder(path);
        }

        private static string BuildJson()
        {
            var builder = new StringBuilder();
            var meshes = new List<Mesh>();
            var meshIds = new Dictionary<Mesh, int>();

            builder.Append("{\"version\":1,");
            builder.Append("\"name\":\"").Append(Escape(UnityEngine.SceneManagement.SceneManager.GetActiveScene().name)).Append("\",");

            // Render geometry.
            builder.Append("\"meshes\":[");
            var firstMesh = true;
            foreach (var filter in Object.FindObjectsOfType<MeshFilter>())
            {
                if (filter.sharedMesh == null) continue;
                var renderer = filter.GetComponent<MeshRenderer>();
                if (renderer == null || !renderer.enabled) continue;
                if (!filter.gameObject.activeInHierarchy) continue;

                if (!firstMesh) builder.Append(',');
                firstMesh = false;

                AppendMesh(builder, filter.sharedMesh, filter.transform.localToWorldMatrix);
                if (!meshIds.ContainsKey(filter.sharedMesh))
                {
                    meshIds[filter.sharedMesh] = meshes.Count;
                    meshes.Add(filter.sharedMesh);
                }
            }
            builder.Append("],");

            // Colliders.
            builder.Append("\"colliders\":[");
            var firstCollider = true;
            foreach (var collider in Object.FindObjectsOfType<Collider>())
            {
                if (!collider.enabled || !collider.gameObject.activeInHierarchy) continue;
                var payload = ExportCollider(collider, meshIds);
                if (payload == null) continue;

                if (!firstCollider) builder.Append(',');
                firstCollider = false;
                builder.Append(payload);
            }
            builder.Append("]}");
            return builder.ToString();
        }

        private static string ExportCollider(Collider collider, Dictionary<Mesh, int> meshIds)
        {
            var culture = CultureInfo.InvariantCulture;
            var transform = collider.transform;

            if (collider is MeshCollider meshCollider && meshCollider.sharedMesh != null)
            {
                var builder = new StringBuilder();
                builder.Append("{\"type\":\"mesh\",");
                AppendMeshFields(builder, meshCollider.sharedMesh, transform.localToWorldMatrix, culture);
                builder.Append('}');
                return builder.ToString();
            }

            if (collider is BoxCollider box)
            {
                var corners = new Vector3[8];
                var center = box.center;
                var half = box.size * 0.5f;
                var index = 0;
                for (var y = -1; y <= 1; y += 2)
                {
                    for (var z = -1; z <= 1; z += 2)
                    {
                        for (var x = -1; x <= 1; x += 2)
                        {
                            var local = new Vector3(center.x + half.x * x, center.y + half.y * y, center.z + half.z * z);
                            corners[index++] = transform.TransformPoint(local);
                        }
                    }
                }

                var builder = new StringBuilder("{\"type\":\"box\",\"corners\":[");
                for (var i = 0; i < corners.Length; i++)
                {
                    if (i > 0) builder.Append(',');
                    AppendVector(builder, corners[i], culture);
                }
                builder.Append("]}");
                return builder.ToString();
            }

            if (collider is SphereCollider sphere)
            {
                var worldCenter = transform.TransformPoint(sphere.center);
                var scale = transform.lossyScale;
                var radius = sphere.radius * Mathf.Max(Mathf.Abs(scale.x), Mathf.Abs(scale.y), Mathf.Abs(scale.z));
                return "{\"type\":\"sphere\",\"center\":" + VectorJson(worldCenter, culture) +
                       ",\"radius\":" + radius.ToString("0.####", culture) + "}";
            }

            if (collider is CapsuleCollider capsule)
            {
                var direction = capsule.direction;
                var axis = direction == 0 ? Vector3.right : direction == 1 ? Vector3.up : Vector3.forward;
                var lossy = transform.lossyScale;
                var halfHeight = Mathf.Max(0f, capsule.height * 0.5f - capsule.radius);
                var scale = Mathf.Abs(axis.x) > 0.5f ? Mathf.Abs(lossy.x) : Mathf.Abs(axis.y) > 0.5f ? Mathf.Abs(lossy.y) : Mathf.Abs(lossy.z);

                var a = transform.TransformPoint(capsule.center - axis * halfHeight);
                var b = transform.TransformPoint(capsule.center + axis * halfHeight);
                var radius = capsule.radius * scale;
                return "{\"type\":\"capsule\",\"a\":" + VectorJson(a, culture) + ",\"b\":" + VectorJson(b, culture) +
                       ",\"radius\":" + radius.ToString("0.####", culture) + "}";
            }

            return null;
        }

        private static void AppendMesh(StringBuilder builder, Mesh mesh, Matrix4x4 matrix)
        {
            builder.Append('{');
            AppendMeshFields(builder, mesh, matrix, CultureInfo.InvariantCulture);
            builder.Append('}');
        }

        private static void AppendMeshFields(StringBuilder builder, Mesh mesh, Matrix4x4 matrix, CultureInfo culture)
        {
            builder.Append("\"name\":\"").Append(Escape(mesh.name)).Append("\",");
            builder.Append("\"positions\":[");
            var vertices = mesh.vertices;
            for (var i = 0; i < vertices.Length; i++)
            {
                if (i > 0) builder.Append(',');
                AppendVector(builder, matrix.MultiplyPoint3x4(vertices[i]), culture);
            }
            builder.Append("],\"indices\":[");
            var triangles = mesh.triangles;
            for (var i = 0; i < triangles.Length; i++)
            {
                if (i > 0) builder.Append(',');
                builder.Append(triangles[i].ToString(culture));
            }
            builder.Append(']');
        }

        private static void AppendVector(StringBuilder builder, Vector3 value, CultureInfo culture)
        {
            builder.Append('[')
                .Append(value.x.ToString("0.####", culture)).Append(',')
                .Append(value.y.ToString("0.####", culture)).Append(',')
                .Append(value.z.ToString("0.####", culture)).Append(']');
        }

        private static string VectorJson(Vector3 value, CultureInfo culture)
        {
            var builder = new StringBuilder("[");
            AppendVector(builder, value, culture);
            builder.Append(']');
            // AppendVector already wrote the outer brackets, strip the duplicate.
            return builder.ToString().Replace("[[", "[").Replace("]]", "]");
        }

        private static string Escape(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
